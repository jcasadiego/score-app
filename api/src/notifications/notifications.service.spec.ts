import type { Mock } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from './notifications.service';

const LEAD = {
  id: 'lead-1',
  name: 'Ana Pérez',
  family: 'CATALOG' as const,
  utmSource: 'instagram',
};

describe('NotificationsService', () => {
  let users: { findActiveEmails: Mock };
  let mail: { sendNewLeadNotice: Mock; sendDiagnosticCompletedNotice: Mock };
  let service: NotificationsService;

  beforeEach(() => {
    users = {
      findActiveEmails: vi.fn().mockResolvedValue(['a@mfp.com', 'b@mfp.com']),
    };
    mail = {
      sendNewLeadNotice: vi.fn().mockResolvedValue({ sent: true }),
      sendDiagnosticCompletedNotice: vi.fn().mockResolvedValue({ sent: true }),
    };
    const config = {
      get: vi.fn().mockReturnValue('https://panel.example.com'),
    };
    service = new NotificationsService(
      users as unknown as UsersService,
      mail as unknown as MailService,
      config as unknown as ConfigService<ValidatedEnv, true>,
    );
  });

  it('avisa del lead nuevo a cada usuario activo, con enlace a Leads', async () => {
    service.notifyNewLead(LEAD);

    await vi.waitFor(() =>
      expect(mail.sendNewLeadNotice).toHaveBeenCalledTimes(2),
    );
    expect(mail.sendNewLeadNotice).toHaveBeenCalledWith(
      'a@mfp.com',
      expect.objectContaining({
        name: 'Ana Pérez',
        family: 'CATALOG',
        utmSource: 'instagram',
        link: 'https://panel.example.com/leads',
      }),
      { entity: 'Lead', entityId: 'lead-1' },
    );
    expect(mail.sendNewLeadNotice.mock.calls[1][0]).toBe('b@mfp.com');
  });

  it('avisa del diagnóstico completado con enlace escapado a su detalle', async () => {
    service.notifyDiagnosticCompleted({
      diagnosticId: '../users',
      leadName: 'Ana Pérez',
      family: 'B2B',
    });

    await vi.waitFor(() =>
      expect(mail.sendDiagnosticCompletedNotice).toHaveBeenCalledTimes(2),
    );
    expect(mail.sendDiagnosticCompletedNotice).toHaveBeenCalledWith(
      'a@mfp.com',
      {
        leadName: 'Ana Pérez',
        family: 'B2B',
        link: 'https://panel.example.com/diagnostics/..%2Fusers',
      },
      { entity: 'Diagnostic', entityId: '../users' },
    );
  });

  it('sin usuarios activos no envía nada ni falla', async () => {
    users.findActiveEmails.mockResolvedValue([]);

    expect(() => service.notifyNewLead(LEAD)).not.toThrow();

    await vi.waitFor(() =>
      expect(users.findActiveEmails).toHaveBeenCalledOnce(),
    );
    expect(mail.sendNewLeadNotice).not.toHaveBeenCalled();
  });

  it('si falla la consulta de destinatarios, no se propaga a quien avisó', async () => {
    users.findActiveEmails.mockRejectedValue(new Error('db caída'));

    expect(() => service.notifyNewLead(LEAD)).not.toThrow();

    await vi.waitFor(() =>
      expect(users.findActiveEmails).toHaveBeenCalledOnce(),
    );
    expect(mail.sendNewLeadNotice).not.toHaveBeenCalled();
  });
});
