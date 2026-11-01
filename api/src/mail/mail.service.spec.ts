import type { Mock } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { ValidatedEnv } from '../config/validate-env';
import { MailPort } from './mail.port';
import { MailService, maskEmail } from './mail.service';

const LINK = 'https://diagnostico.example.com/e/token-secreto-123';

describe('MailService', () => {
  let provider: { send: Mock };
  let audit: { record: Mock };
  let service: MailService;

  beforeEach(() => {
    provider = { send: vi.fn() };
    audit = { record: vi.fn().mockResolvedValue({}) };
    const config = { get: vi.fn().mockReturnValue(undefined) };
    service = new MailService(
      provider as unknown as MailPort,
      audit as unknown as AuditService,
      config as unknown as ConfigService<ValidatedEnv, true>,
    );
  });

  it('envía el enlace del diagnóstico en español, con el enlace en el cuerpo', async () => {
    provider.send.mockResolvedValue({ sent: true, providerId: 'em_1' });

    const result = await service.sendDiagnosticLink({
      to: 'ana@example.com',
      name: 'Ana',
      link: LINK,
    });

    expect(result).toEqual({ sent: true, providerId: 'em_1' });
    const message = provider.send.mock.calls[0][0];
    expect(message.to).toBe('ana@example.com');
    expect(message.subject).toBe('Tu diagnóstico SCORE');
    expect(message.html).toContain(`href="${LINK}"`);
    expect(message.html).toContain('lang="es"');
    expect(message.text).toContain(LINK);
  });

  it('registra el envío en la bitácora sin el enlace ni el email completo', async () => {
    provider.send.mockResolvedValue({ sent: true, providerId: 'em_1' });

    await service.sendLinkRecovery(
      { to: 'ana@example.com', name: 'Ana', link: LINK },
      { entity: 'Case', entityId: 'case-1' },
    );

    expect(audit.record).toHaveBeenCalledWith({
      actorType: 'SYSTEM',
      actorId: undefined,
      action: 'EMAIL_SENT',
      entity: 'Case',
      entityId: 'case-1',
      data: {
        type: 'LINK_RECOVERY',
        recipient: 'a***@example.com',
        providerId: 'em_1',
      },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      'token-secreto',
    );
  });

  it('un fallo del proveedor se devuelve y se audita, sin lanzar', async () => {
    provider.send.mockResolvedValue({
      sent: false,
      reason: 'daily_quota_exceeded (429): límite diario',
    });

    const result = await service.sendDiagnosticLink({
      to: 'ana@example.com',
      name: 'Ana',
      link: LINK,
    });

    expect(result).toEqual({
      sent: false,
      reason: 'daily_quota_exceeded (429): límite diario',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EMAIL_FAILED',
        entity: 'Email',
        data: expect.objectContaining({
          reason: 'daily_quota_exceeded (429): límite diario',
        }),
      }),
    );
  });

  it('si el adaptador lanza, lo convierte en fallo controlado', async () => {
    provider.send.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      service.sendDiagnosticLink({
        to: 'ana@example.com',
        name: 'Ana',
        link: LINK,
      }),
    ).resolves.toEqual({ sent: false, reason: 'ECONNRESET' });
  });

  it('si la bitácora falla, el envío igual devuelve su resultado', async () => {
    provider.send.mockResolvedValue({ sent: true, providerId: 'em_1' });
    audit.record.mockRejectedValue(new Error('db caída'));

    await expect(
      service.sendDiagnosticLink({
        to: 'ana@example.com',
        name: 'Ana',
        link: LINK,
      }),
    ).resolves.toEqual({ sent: true, providerId: 'em_1' });
  });

  it('escapa el nombre del destinatario en el HTML', async () => {
    provider.send.mockResolvedValue({ sent: true, providerId: 'em_1' });

    await service.sendDiagnosticLink({
      to: 'ana@example.com',
      name: '<script>alert(1)</script>',
      link: LINK,
    });

    const { html } = provider.send.mock.calls[0][0];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('maskEmail', () => {
  it('deja solo la primera letra y el dominio', () => {
    expect(maskEmail('ana.perez@dominio.com')).toBe('a***@dominio.com');
    expect(maskEmail('sin-arroba')).toBe('***');
  });
});
