import type { Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EnvValidado } from '../config/validar-env';
import { CorreoService } from '../correo/correo.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import {
  hashToken,
  MENSAJE_SOLICITUD,
  RecuperacionContrasenaService,
} from './recuperacion-contrasena.service';

vi.mock('argon2');

const USUARIO = {
  id: 'u1',
  nombre: 'Ana',
  email: 'ana@test.local',
  activo: true,
};

describe('RecuperacionContrasenaService', () => {
  let prisma: {
    $transaction: Mock;
    tokenRecuperacionContrasena: {
      create: Mock;
      deleteMany: Mock;
      findUnique: Mock;
      updateMany: Mock;
    };
    usuario: { update: Mock };
  };
  let usuarios: { buscarPorEmail: Mock };
  let correo: { enviarRestablecerContrasena: Mock };
  let auditoria: { registrar: Mock };
  let service: RecuperacionContrasenaService;

  beforeEach(() => {
    (argon2.hash as Mock).mockResolvedValue('hash-nuevo');
    prisma = {
      $transaction: vi.fn(),
      tokenRecuperacionContrasena: {
        create: vi.fn().mockReturnValue('crear'),
        deleteMany: vi.fn().mockReturnValue('borrar'),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      usuario: { update: vi.fn() },
    };
    // Forma de arreglo (solicitar) o callback interactivo (restablecer).
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg as unknown[]),
    );
    usuarios = { buscarPorEmail: vi.fn() };
    correo = {
      enviarRestablecerContrasena: vi
        .fn()
        .mockResolvedValue({ enviado: true, proveedorId: 'em_1' }),
    };
    auditoria = { registrar: vi.fn().mockResolvedValue({}) };
    const config = {
      get: vi.fn().mockReturnValue('https://panel.example.com'),
    };
    service = new RecuperacionContrasenaService(
      prisma as unknown as PrismaService,
      usuarios as unknown as UsuariosService,
      correo as unknown as CorreoService,
      auditoria as unknown as AuditoriaService,
      config as unknown as ConfigService<EnvValidado, true>,
    );
  });

  describe('solicitar', () => {
    it('responde lo mismo exista o no el correo', () => {
      usuarios.buscarPorEmail.mockResolvedValue(null);
      expect(service.solicitar('nadie@test.local')).toEqual({
        mensaje: MENSAJE_SOLICITUD,
      });

      usuarios.buscarPorEmail.mockResolvedValue(USUARIO);
      expect(service.solicitar(USUARIO.email)).toEqual({
        mensaje: MENSAJE_SOLICITUD,
      });
    });

    it('con usuario activo invalida los pendientes, guarda el hash y envía el enlace', async () => {
      usuarios.buscarPorEmail.mockResolvedValue(USUARIO);

      await service.procesarSolicitud(USUARIO.email);

      expect(
        prisma.tokenRecuperacionContrasena.deleteMany,
      ).toHaveBeenCalledWith({ where: { usuarioId: 'u1', usadoEn: null } });
      const { enlace } = correo.enviarRestablecerContrasena.mock.calls[0][0];
      const token = new URL(enlace).searchParams.get('token');
      expect(enlace).toMatch(
        /^https:\/\/panel\.example\.com\/restablecer-contrasena\?token=/,
      );
      const { data } =
        prisma.tokenRecuperacionContrasena.create.mock.calls[0][0];
      expect(data.tokenHash).toBe(hashToken(token));
      expect(data.tokenHash).not.toBe(token);
      const vigenciaMs = data.expiraEn.getTime() - Date.now();
      expect(vigenciaMs).toBeGreaterThan(59 * 60 * 1000);
      expect(vigenciaMs).toBeLessThanOrEqual(60 * 60 * 1000);
      expect(JSON.stringify(auditoria.registrar.mock.calls)).not.toContain(
        token,
      );
    });

    it('con correo inexistente o usuario inactivo no envía nada', async () => {
      usuarios.buscarPorEmail.mockResolvedValueOnce(null);
      await service.procesarSolicitud('nadie@test.local');
      usuarios.buscarPorEmail.mockResolvedValueOnce({
        ...USUARIO,
        activo: false,
      });
      await service.procesarSolicitud(USUARIO.email);

      expect(prisma.tokenRecuperacionContrasena.create).not.toHaveBeenCalled();
      expect(correo.enviarRestablecerContrasena).not.toHaveBeenCalled();
    });
  });

  describe('restablecer', () => {
    const vigente = {
      id: 't1',
      usuarioId: 'u1',
      usadoEn: null,
      expiraEn: new Date(Date.now() + 60_000),
      usuario: { activo: true },
    };

    it('cambia la contraseña, sube versionSesion y marca el enlace como usado', async () => {
      prisma.tokenRecuperacionContrasena.findUnique.mockResolvedValue(vigente);

      await service.restablecer('token-ok', 'nueva-clave');

      expect(
        prisma.tokenRecuperacionContrasena.findUnique,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashToken('token-ok') },
        }),
      );
      expect(
        prisma.tokenRecuperacionContrasena.updateMany,
      ).toHaveBeenCalledWith({
        where: { id: 't1', usadoEn: null },
        data: { usadoEn: expect.any(Date) },
      });
      expect(prisma.usuario.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: 'hash-nuevo', versionSesion: { increment: 1 } },
      });
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'CONTRASENA_RESTABLECIDA',
          entidadId: 'u1',
        }),
      );
    });

    it.each([
      ['inexistente', null],
      ['ya usado', { ...vigente, usadoEn: new Date() }],
      ['vencido', { ...vigente, expiraEn: new Date(Date.now() - 1) }],
      ['de usuario inactivo', { ...vigente, usuario: { activo: false } }],
    ])('rechaza con 400 un enlace %s', async (_caso, registro) => {
      prisma.tokenRecuperacionContrasena.findUnique.mockResolvedValue(registro);

      await expect(service.restablecer('t', 'nueva-clave')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });

    it('si otra request ya usó el enlace, no cambia la contraseña', async () => {
      prisma.tokenRecuperacionContrasena.findUnique.mockResolvedValue(vigente);
      prisma.tokenRecuperacionContrasena.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(service.restablecer('t', 'nueva-clave')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.usuario.update).not.toHaveBeenCalled();
    });
  });
});
