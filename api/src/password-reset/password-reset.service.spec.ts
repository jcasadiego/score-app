import type { Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  hashToken,
  REQUEST_MESSAGE,
  PasswordResetService,
} from './password-reset.service';

vi.mock('argon2');

const USER = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@test.local',
  active: true,
};

describe('PasswordResetService', () => {
  let prisma: {
    $transaction: Mock;
    passwordResetToken: {
      create: Mock;
      deleteMany: Mock;
      findUnique: Mock;
      updateMany: Mock;
    };
    user: { update: Mock };
  };
  let users: { findByEmail: Mock };
  let mail: { sendPasswordReset: Mock };
  let audit: { record: Mock };
  let service: PasswordResetService;

  beforeEach(() => {
    (argon2.hash as Mock).mockResolvedValue('hash-nuevo');
    prisma = {
      $transaction: vi.fn(),
      passwordResetToken: {
        create: vi.fn().mockReturnValue('crear'),
        deleteMany: vi.fn().mockReturnValue('borrar'),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: { update: vi.fn() },
    };
    // Forma de arreglo (solicitar) o callback interactivo (restablecer).
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg as unknown[]),
    );
    users = { findByEmail: vi.fn() };
    mail = {
      sendPasswordReset: vi
        .fn()
        .mockResolvedValue({ sent: true, providerId: 'em_1' }),
    };
    audit = { record: vi.fn().mockResolvedValue({}) };
    const config = {
      get: vi.fn().mockReturnValue('https://panel.example.com'),
    };
    service = new PasswordResetService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      mail as unknown as MailService,
      audit as unknown as AuditService,
      config as unknown as ConfigService<ValidatedEnv, true>,
    );
  });

  describe('request', () => {
    it('responde lo mismo exista o no el correo', () => {
      users.findByEmail.mockResolvedValue(null);
      expect(service.request('nadie@test.local')).toEqual({
        message: REQUEST_MESSAGE,
      });

      users.findByEmail.mockResolvedValue(USER);
      expect(service.request(USER.email)).toEqual({
        message: REQUEST_MESSAGE,
      });
    });

    it('con usuario activo invalida los pendientes, guarda el hash y envía el enlace', async () => {
      users.findByEmail.mockResolvedValue(USER);

      await service.processRequest(USER.email);

      expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', usedAt: null },
      });
      const { link } = mail.sendPasswordReset.mock.calls[0][0];
      const token = new URL(link).searchParams.get('token');
      expect(link).toMatch(
        /^https:\/\/panel\.example\.com\/reset-password\?token=/,
      );
      const { data } = prisma.passwordResetToken.create.mock.calls[0][0];
      expect(data.tokenHash).toBe(hashToken(token));
      expect(data.tokenHash).not.toBe(token);
      const ttlMs = data.expiresAt.getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(59 * 60 * 1000);
      expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000);
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain(token);
    });

    it('con correo inexistente o usuario inactivo no envía nada', async () => {
      users.findByEmail.mockResolvedValueOnce(null);
      await service.processRequest('nadie@test.local');
      users.findByEmail.mockResolvedValueOnce({
        ...USER,
        active: false,
      });
      await service.processRequest(USER.email);

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    const validToken = {
      id: 't1',
      userId: 'u1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { active: true },
    };

    it('cambia la contraseña, sube sessionVersion y marca el enlace como usado', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validToken);

      await service.confirm('token-ok', 'nueva-clave');

      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashToken('token-ok') },
        }),
      );
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { id: 't1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: 'hash-nuevo', sessionVersion: { increment: 1 } },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PASSWORD_RESET_COMPLETED',
          entityId: 'u1',
        }),
      );
    });

    it.each([
      ['inexistente', null],
      ['ya usado', { ...validToken, usedAt: new Date() }],
      ['vencido', { ...validToken, expiresAt: new Date(Date.now() - 1) }],
      ['de usuario inactivo', { ...validToken, user: { active: false } }],
    ])('rechaza con 400 un enlace %s', async (_label, resetToken) => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);

      await expect(service.confirm('t', 'nueva-clave')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('si otra request ya usó el enlace, no cambia la contraseña', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(validToken);
      prisma.passwordResetToken.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(service.confirm('t', 'nueva-clave')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
