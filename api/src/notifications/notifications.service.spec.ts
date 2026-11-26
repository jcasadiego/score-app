import type { Mock } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnv } from '../config/validate-env';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { NoticeBudgetService } from './notice-budget.service';
import { NotificationsService } from './notifications.service';

const LEAD = {
  id: 'lead-1',
  name: 'Ana Pérez',
  family: 'CATALOG' as const,
  utmSource: 'instagram',
};

describe('NotificationsService', () => {
  let users: { findActiveEmails: Mock };
  let mail: {
    sendNewLeadNotice: Mock;
    sendDiagnosticCompletedNotice: Mock;
    recordSuppressed: Mock;
  };
  let budget: { consume: Mock };
  let service: NotificationsService;

  beforeEach(() => {
    users = {
      findActiveEmails: vi.fn().mockResolvedValue(['a@mfp.com', 'b@mfp.com']),
    };
    mail = {
      sendNewLeadNotice: vi.fn().mockResolvedValue({ sent: true }),
      sendDiagnosticCompletedNotice: vi.fn().mockResolvedValue({ sent: true }),
      recordSuppressed: vi.fn().mockResolvedValue(undefined),
    };
    budget = { consume: vi.fn().mockResolvedValue(1) };
    const config = {
      get: vi.fn((key: string) =>
        key === 'NEW_LEAD_NOTICE_DAILY_LIMIT' ? 3 : 'https://panel.example.com',
      ),
    };
    service = new NotificationsService(
      users as unknown as UsersService,
      mail as unknown as MailService,
      config as unknown as ConfigService<ValidatedEnv, true>,
      budget as unknown as NoticeBudgetService,
    );
  });

  it('avisa del lead nuevo a cada destinatario, con enlace a Leads', async () => {
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

  it('el lead nuevo va solo a los Aprobadores', async () => {
    service.notifyNewLead(LEAD);

    await vi.waitFor(() =>
      expect(users.findActiveEmails).toHaveBeenCalledOnce(),
    );
    expect(users.findActiveEmails).toHaveBeenCalledWith(['ADMIN']);
  });

  it('el diagnóstico completado va a Revisores y Aprobadores', async () => {
    service.notifyDiagnosticCompleted({
      diagnosticId: 'diag-1',
      leadName: 'Ana Pérez',
      family: 'B2B',
    });

    await vi.waitFor(() =>
      expect(users.findActiveEmails).toHaveBeenCalledOnce(),
    );
    expect(users.findActiveEmails).toHaveBeenCalledWith(['ADMIN', 'REVIEWER']);
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

  it('sin destinatarios no envía nada ni falla', async () => {
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

  describe('cupo diario de avisos de lead nuevo (PF-36)', () => {
    it('hasta el cupo, avisa normal', async () => {
      budget.consume.mockResolvedValue(3);

      service.notifyNewLead(LEAD);

      await vi.waitFor(() =>
        expect(mail.sendNewLeadNotice).toHaveBeenCalledTimes(2),
      );
      expect(budget.consume).toHaveBeenCalledWith('NEW_LEAD_NOTICE');
      expect(mail.recordSuppressed).not.toHaveBeenCalled();
    });

    it('pasado el cupo, no envía y deja constancia sin datos del lead', async () => {
      budget.consume.mockResolvedValue(4);

      service.notifyNewLead(LEAD);

      await vi.waitFor(() =>
        expect(mail.recordSuppressed).toHaveBeenCalledOnce(),
      );
      expect(mail.recordSuppressed).toHaveBeenCalledWith(
        'NEW_LEAD_NOTICE',
        'DAILY_LIMIT',
        { entity: 'Lead', entityId: 'lead-1' },
      );
      expect(users.findActiveEmails).not.toHaveBeenCalled();
      expect(mail.sendNewLeadNotice).not.toHaveBeenCalled();
    });

    it('si el contador falla, avisa igual', async () => {
      budget.consume.mockRejectedValue(new Error('db caída'));

      expect(() => service.notifyNewLead(LEAD)).not.toThrow();

      await vi.waitFor(() =>
        expect(mail.sendNewLeadNotice).toHaveBeenCalledTimes(2),
      );
      expect(mail.recordSuppressed).not.toHaveBeenCalled();
    });

    it('si falla la constancia, no se propaga a quien avisó', async () => {
      budget.consume.mockResolvedValue(10);
      mail.recordSuppressed.mockRejectedValue(new Error('bitácora caída'));

      expect(() => service.notifyNewLead(LEAD)).not.toThrow();

      await vi.waitFor(() =>
        expect(mail.recordSuppressed).toHaveBeenCalledOnce(),
      );
      expect(mail.sendNewLeadNotice).not.toHaveBeenCalled();
    });

    it('el diagnóstico completado no gasta el cupo', async () => {
      service.notifyDiagnosticCompleted({
        diagnosticId: 'diag-1',
        leadName: 'Ana Pérez',
        family: 'B2B',
      });

      await vi.waitFor(() =>
        expect(mail.sendDiagnosticCompletedNotice).toHaveBeenCalledTimes(2),
      );
      expect(budget.consume).not.toHaveBeenCalled();
    });
  });
});
