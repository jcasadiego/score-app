import type { Mock } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CrmSyncErrorCode,
  CrmSyncEventStatus,
  CrmSyncEventType,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { FunnelUpCrmAdapter } from './adapters/funnelup-crm.adapter';
import { SimulatedCrmAdapter } from './adapters/simulated-crm.adapter';
import {
  BACKOFF_MS,
  CrmSyncService,
  MAX_ATTEMPTS,
  MAX_RETRY_AFTER_MS,
} from './crm-sync.service';
import { CrmAdapterError } from './crm.port';
import { syncStatusOf } from './crm.types';

const LEAD = {
  name: 'Ana Pérez',
  email: 'ana@example.com',
  phone: '+52 55 1234 5678',
  family: 'CATALOG',
  utmSource: 'instagram',
  utmMedium: null,
  utmCampaign: null,
  crmContactId: null as string | null,
};

function event(type: CrmSyncEventType, attempts = 0) {
  return { id: 'evt-1', leadId: 'lead-1', type, attempts };
}

describe('CrmSyncService', () => {
  let tx: {
    $queryRaw: Mock;
    lead: { findUniqueOrThrow: Mock; update: Mock };
    crmSyncEvent: { update: Mock; updateMany: Mock; findFirst: Mock };
  };
  let audit: { record: Mock };
  let env: Record<string, unknown>;

  function build() {
    const prisma = {
      ...tx,
      $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    return new CrmSyncService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      { get: (key: string) => env[key] } as unknown as ConfigService<
        never,
        true
      >,
    );
  }

  /** Corre una pasada con un solo evento en la cola. */
  async function sendOne(service: CrmSyncService, claimed: object) {
    tx.$queryRaw.mockResolvedValueOnce([claimed]).mockResolvedValue([]);
    return service.processDue();
  }

  beforeEach(() => {
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      lead: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...LEAD }),
        update: vi.fn(),
      },
      crmSyncEvent: {
        update: vi.fn(),
        updateMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    audit = { record: vi.fn() };
    env = {};
  });

  it('por defecto usa el CRM simulado', () => {
    expect(build().status()).toEqual({
      provider: 'simulated',
      simulated: true,
    });
  });

  it('sin eventos que toquen, la pasada no envía nada', async () => {
    await expect(build().processDue()).resolves.toBe(0);
    expect(tx.crmSyncEvent.update).not.toHaveBeenCalled();
  });

  it('un lead nuevo crea el contacto, marca el evento enviado y guarda el id', async () => {
    const upsert = vi.spyOn(SimulatedCrmAdapter.prototype, 'upsertContact');

    await expect(
      sendOne(build(), event(CrmSyncEventType.LEAD_CREATED)),
    ).resolves.toBe(1);

    // Solo contacto, familia y UTM: nunca el id del CRM ni otros datos.
    const contact = { ...LEAD } as Partial<typeof LEAD>;
    delete contact.crmContactId;
    expect(upsert).toHaveBeenCalledWith(contact, {
      status: 'Lead',
      tags: ['score-lead'],
    });
    expect(tx.crmSyncEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: expect.objectContaining({
        status: CrmSyncEventStatus.SENT,
        attempts: 1,
        sentAt: expect.any(Date),
      }),
    });
    expect(tx.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { crmContactId: expect.stringMatching(/^sim_/) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CRM_SYNC_SENT', entityId: 'evt-1' }),
      tx,
    );
    upsert.mockRestore();
  });

  it('un cambio de estado de un contacto que ya existe solo actualiza el estado', async () => {
    tx.lead.findUniqueOrThrow.mockResolvedValue({
      ...LEAD,
      crmContactId: 'sim_abc',
    });
    const updateStatus = vi.spyOn(
      SimulatedCrmAdapter.prototype,
      'updateStatus',
    );

    await sendOne(build(), event(CrmSyncEventType.REPORT_DELIVERED));

    expect(updateStatus).toHaveBeenCalledWith('sim_abc', {
      status: 'Entregado',
      tags: ['score-informe-entregado'],
    });
    expect(tx.lead.update).not.toHaveBeenCalled();
    updateStatus.mockRestore();
  });

  it('con el CRM real, un id del simulado no se usa: crea el contacto y guarda el id nuevo', async () => {
    env = {
      CRM_PROVIDER: 'funnelup',
      CRM_FUNNELUP_TOKEN: 'pit-x',
      CRM_FUNNELUP_LOCATION_ID: 'loc123ABC456',
    };
    tx.lead.findUniqueOrThrow.mockResolvedValue({
      ...LEAD,
      crmContactId: 'sim_abc',
    });
    const upsert = vi
      .spyOn(FunnelUpCrmAdapter.prototype, 'upsertContact')
      .mockResolvedValue({ contactId: 'real123' });
    const updateStatus = vi.spyOn(FunnelUpCrmAdapter.prototype, 'updateStatus');

    await sendOne(build(), event(CrmSyncEventType.REPORT_DELIVERED));

    expect(upsert).toHaveBeenCalled();
    expect(updateStatus).not.toHaveBeenCalled();
    expect(tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { crmContactId: 'real123' } }),
    );
    upsert.mockRestore();
    updateStatus.mockRestore();
  });

  it('un error que se resuelve solo se reprograma con espera creciente', async () => {
    env.CRM_SIMULATED_FAILURE = CrmSyncErrorCode.PROVIDER_ERROR;
    const before = Date.now();

    await sendOne(build(), event(CrmSyncEventType.DIAGNOSTIC_STARTED, 1));

    const { data } = tx.crmSyncEvent.update.mock.calls[0][0];
    expect(data).toMatchObject({
      status: CrmSyncEventStatus.PENDING,
      attempts: 2,
      lastErrorCode: CrmSyncErrorCode.PROVIDER_ERROR,
      lastHttpStatus: 503,
    });
    // Segundo intento fallido: la segunda espera.
    expect(data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + BACKOFF_MS[1],
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('respeta la espera que pide el proveedor si es mayor', async () => {
    const service = build();
    const adapter = (service as unknown as { adapter: SimulatedCrmAdapter })
      .adapter;
    vi.spyOn(adapter, 'upsertContact').mockRejectedValue(
      new CrmAdapterError(CrmSyncErrorCode.RATE_LIMITED, 429, 3 * 60 * 60_000),
    );
    const before = Date.now();

    await sendOne(service, event(CrmSyncEventType.LEAD_CREATED));

    const { data } = tx.crmSyncEvent.update.mock.calls[0][0];
    expect(data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + 3 * 60 * 60_000,
    );
  });

  it('acota la espera que pide el proveedor y descarta un estado HTTP inválido', async () => {
    const service = build();
    const adapter = (service as unknown as { adapter: SimulatedCrmAdapter })
      .adapter;
    vi.spyOn(adapter, 'upsertContact').mockRejectedValue(
      new CrmAdapterError(CrmSyncErrorCode.RATE_LIMITED, 999, 1e15),
    );
    const before = Date.now();

    await sendOne(service, event(CrmSyncEventType.LEAD_CREATED));

    const { data } = tx.crmSyncEvent.update.mock.calls[0][0];
    expect(data.lastHttpStatus).toBeNull();
    expect(data.nextAttemptAt.getTime()).toBeLessThanOrEqual(
      Date.now() + MAX_RETRY_AFTER_MS,
    );
    expect(data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + MAX_RETRY_AFTER_MS,
    );
  });

  it('un id de contacto que no cabe en la base cuenta como error del proveedor, sin escribir el lead', async () => {
    const service = build();
    const adapter = (service as unknown as { adapter: SimulatedCrmAdapter })
      .adapter;
    vi.spyOn(adapter, 'upsertContact').mockResolvedValue({
      contactId: 'x'.repeat(101),
    });

    await sendOne(service, event(CrmSyncEventType.LEAD_CREATED));

    expect(tx.lead.update).not.toHaveBeenCalled();
    expect(tx.crmSyncEvent.update.mock.calls[0][0].data).toMatchObject({
      status: CrmSyncEventStatus.PENDING,
      lastErrorCode: CrmSyncErrorCode.PROVIDER_ERROR,
    });
  });

  it('en el último intento queda fallido y se registra en la bitácora', async () => {
    env.CRM_SIMULATED_FAILURE = CrmSyncErrorCode.TIMEOUT;

    await sendOne(
      build(),
      event(CrmSyncEventType.DIAGNOSTIC_COMPLETED, MAX_ATTEMPTS - 1),
    );

    expect(tx.crmSyncEvent.update.mock.calls[0][0].data).toMatchObject({
      status: CrmSyncEventStatus.FAILED,
      attempts: MAX_ATTEMPTS,
      lastErrorCode: CrmSyncErrorCode.TIMEOUT,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CRM_SYNC_FAILED',
        data: {
          leadId: 'lead-1',
          type: CrmSyncEventType.DIAGNOSTIC_COMPLETED,
          attempts: MAX_ATTEMPTS,
          code: CrmSyncErrorCode.TIMEOUT,
        },
      }),
      tx,
    );
  });

  it.each([CrmSyncErrorCode.INVALID_DATA, CrmSyncErrorCode.AUTH_FAILED])(
    'un %s no se reintenta solo',
    async (code) => {
      env.CRM_SIMULATED_FAILURE = code;

      await sendOne(build(), event(CrmSyncEventType.LEAD_CREATED));

      expect(tx.crmSyncEvent.update.mock.calls[0][0].data.status).toBe(
        CrmSyncEventStatus.FAILED,
      );
    },
  );

  it('un error inesperado cuenta como del proveedor y no guarda su mensaje', async () => {
    const service = build();
    const adapter = (service as unknown as { adapter: SimulatedCrmAdapter })
      .adapter;
    vi.spyOn(adapter, 'upsertContact').mockRejectedValue(
      new Error('respuesta con ana@example.com'),
    );

    await sendOne(service, event(CrmSyncEventType.LEAD_CREATED));

    const { data } = tx.crmSyncEvent.update.mock.calls[0][0];
    expect(data.lastErrorCode).toBe(CrmSyncErrorCode.PROVIDER_ERROR);
    expect(JSON.stringify(data)).not.toContain('ana@example.com');
  });

  describe('retry', () => {
    it('vuelve a poner en cola un fallido y lo registra con quién lo pidió', async () => {
      tx.crmSyncEvent.updateMany.mockResolvedValue({ count: 1 });
      tx.crmSyncEvent.findFirst.mockResolvedValue({
        id: 'evt-1',
        type: CrmSyncEventType.LEAD_CREATED,
      });

      await build().retry('lead-1', 'evt-1', 'user-1');

      expect(tx.crmSyncEvent.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'evt-1',
          leadId: 'lead-1',
          status: CrmSyncEventStatus.FAILED,
        },
        data: expect.objectContaining({
          status: CrmSyncEventStatus.PENDING,
          attempts: 0,
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'CRM_SYNC_RETRIED',
          entityId: 'evt-1',
        }),
        tx,
      );
    });

    it('404 si el evento no es de ese lead', async () => {
      tx.crmSyncEvent.updateMany.mockResolvedValue({ count: 0 });
      tx.crmSyncEvent.findFirst.mockResolvedValue(null);

      await expect(
        build().retry('otro-lead', 'evt-1', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 si no está fallido', async () => {
      tx.crmSyncEvent.updateMany.mockResolvedValue({ count: 0 });
      tx.crmSyncEvent.findFirst.mockResolvedValue({ id: 'evt-1' });

      await expect(
        build().retry('lead-1', 'evt-1', 'user-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});

describe('syncStatusOf', () => {
  it.each([
    [{ SENT: 2, FAILED: 1, PENDING: 1 }, 'FAILED'],
    [{ SENT: 2, PENDING: 1 }, 'PENDING'],
    [{ SENT: 3 }, 'SYNCED'],
    [{}, null],
  ])('%j → %s', (counts, expected) => {
    expect(syncStatusOf(counts)).toBe(expected);
  });
});
