import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import {
  AuditActorType,
  CrmSyncErrorCode,
  CrmSyncEventStatus,
  CrmSyncEventType,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import type { ValidatedEnv } from '../config/validate-env';
import { PrismaService } from '../prisma/prisma.service';
import { SimulatedCrmAdapter } from './adapters/simulated-crm.adapter';
import { CRM_SYNC_EVENT_NOT_FAILED } from './crm-codes';
import { CrmAdapter, CrmAdapterError, CrmProviderName } from './crm.port';
import { CRM_STATUS_BY_EVENT, CrmSyncStatus, syncStatusOf } from './crm.types';

/** Intentos antes de dejar el evento `FAILED` a la espera de un reintento manual. */
export const MAX_ATTEMPTS = 6;
/** Espera tras cada intento fallido (el último valor se repite). */
export const BACKOFF_MS = [
  60_000, // 1 min
  5 * 60_000, // 5 min
  30 * 60_000, // 30 min
  2 * 60 * 60_000, // 2 h
  12 * 60 * 60_000, // 12 h
];
/** Tope a la espera que pide el proveedor (429): un valor absurdo no congela el evento. */
export const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;
/** Largo de `leads.crm_contact_id`. */
const MAX_CONTACT_ID_LENGTH = 100;
/** Eventos por pasada del procesador: el resto queda para la siguiente. */
export const BATCH_SIZE = 50;
/**
 * Tope de una transacción de envío: el evento queda bloqueado mientras se
 * llama al CRM, para que ningún otro proceso lo tome. Cubre el tiempo de
 * espera del adapter con margen.
 */
const SEND_TRANSACTION_TIMEOUT_MS = 30_000;

/** Errores que se pueden resolver solos: el resto espera un reintento manual. */
const RETRYABLE: ReadonlySet<CrmSyncErrorCode> = new Set([
  CrmSyncErrorCode.TIMEOUT,
  CrmSyncErrorCode.RATE_LIMITED,
  CrmSyncErrorCode.PROVIDER_ERROR,
]);

const EVENT_SELECT = {
  id: true,
  type: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  lastErrorCode: true,
  lastHttpStatus: true,
  createdAt: true,
  sentAt: true,
} satisfies Prisma.CrmSyncEventSelect;

export type CrmSyncEventView = Prisma.CrmSyncEventGetPayload<{
  select: typeof EVENT_SELECT;
}>;

export interface CrmSyncEventsPage {
  data: CrmSyncEventView[];
  total: number;
  page: number;
  pageSize: number;
}

interface ClaimedEvent {
  id: string;
  leadId: string;
  type: CrmSyncEventType;
  attempts: number;
}

/**
 * Sincronización de SCORE con el CRM, en una sola dirección (PF-80). Cada
 * cambio del recorrido de un lead deja un evento en la bandeja de salida, en
 * la misma transacción que el cambio; aquí se envían en segundo plano, en
 * orden por lead y con reintentos. Si el CRM falla, SCORE sigue igual.
 */
@Injectable()
export class CrmSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(CrmSyncService.name);
  private readonly adapter: CrmAdapter;
  /** La pasada en curso, para no solapar dos en el mismo proceso. */
  private running: Promise<void> | null = null;
  /** Llegó otro aviso durante la pasada: se hace otra al terminar. */
  private again = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService<ValidatedEnv, true>,
  ) {
    this.adapter = createAdapter(
      config.get('CRM_PROVIDER', { infer: true }) ?? 'simulated',
      config.get('CRM_SIMULATED_FAILURE', { infer: true }),
    );
  }

  /** Qué CRM está configurado, sin token ni ids de la cuenta. */
  status(): { provider: CrmProviderName; simulated: boolean } {
    return { provider: this.adapter.name, simulated: this.adapter.simulated };
  }

  /**
   * Deja el evento en la bandeja. Va siempre dentro de la transacción del
   * cambio que lo origina: si esa transacción falla, no queda evento.
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    leadId: string,
    type: CrmSyncEventType,
  ): Promise<void> {
    await tx.crmSyncEvent.create({ data: { leadId, type } });
  }

  /**
   * Pide una pasada del procesador sin esperarla. Se llama después del commit,
   * para que el evento no espere al siguiente ciclo. Nunca lanza.
   */
  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          await this.processDue();
        } catch (error) {
          // La base no respondió: los eventos siguen en la bandeja.
          this.logger.error(
            `Falló la pasada de la bandeja del CRM: ${errorName(error)}`,
          );
        }
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
  }

  /** Al cerrar la app, espera la pasada en curso (no deja conexiones vivas). */
  async onModuleDestroy() {
    this.again = false;
    await this.running;
  }

  /**
   * Envía los eventos que ya tocan, de a uno, hasta vaciar la cola o llegar al
   * tope de la pasada. Devuelve cuántos procesó (enviados o fallidos).
   */
  async processDue(): Promise<number> {
    let processed = 0;
    while (processed < BATCH_SIZE && (await this.processNext())) {
      processed += 1;
    }
    return processed;
  }

  /**
   * Toma el próximo evento que toca y lo envía, todo en una transacción que lo
   * deja bloqueado: dos procesos nunca envían el mismo evento (`SKIP LOCKED`).
   * Un evento solo sale si no hay otro anterior del mismo lead sin enviar (en
   * cola o fallido): así el CRM recibe los cambios en orden. `false` si no
   * había nada que enviar.
   */
  private processNext(): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const [event] = await tx.$queryRaw<ClaimedEvent[]>`
          SELECT e.id, e.lead_id AS "leadId", e.type, e.attempts
          FROM crm_sync_events e
          WHERE e.status = 'PENDING'
            AND e.next_attempt_at <= now()
            AND NOT EXISTS (
              SELECT 1 FROM crm_sync_events p
              WHERE p.lead_id = e.lead_id
                AND p.status IN ('PENDING', 'FAILED')
                AND (p.created_at, p.id) < (e.created_at, e.id)
            )
          ORDER BY e.next_attempt_at, e.created_at, e.id
          LIMIT 1
          FOR UPDATE OF e SKIP LOCKED
        `;
        if (!event) return false;
        await this.send(tx, event);
        return true;
      },
      { timeout: SEND_TRANSACTION_TIMEOUT_MS },
    );
  }

  private async send(tx: Prisma.TransactionClient, event: ClaimedEvent) {
    const lead = await tx.lead.findUniqueOrThrow({
      where: { id: event.leadId },
      select: {
        name: true,
        email: true,
        phone: true,
        family: true,
        utmSource: true,
        utmMedium: true,
        utmCampaign: true,
        crmContactId: true,
      },
    });
    const update = CRM_STATUS_BY_EVENT[event.type];
    const attempts = event.attempts + 1;

    try {
      const { crmContactId, ...contact } = lead;
      // El lead nuevo siempre refresca el contacto; un cambio de estado de un
      // lead que nunca llegó al CRM también lo crea.
      let contactId = crmContactId;
      if (event.type === CrmSyncEventType.LEAD_CREATED || !contactId) {
        ({ contactId } = await this.adapter.upsertContact(contact, update));
      } else {
        await this.adapter.updateStatus(contactId, update);
      }
      // Antes de escribir: un error de la base aborta la transacción y el
      // evento quedaría reintentándose en cada pasada sin contar intentos.
      if (!contactId || contactId.length > MAX_CONTACT_ID_LENGTH) {
        throw new CrmAdapterError(CrmSyncErrorCode.PROVIDER_ERROR);
      }

      await tx.crmSyncEvent.update({
        where: { id: event.id },
        data: {
          status: CrmSyncEventStatus.SENT,
          attempts,
          sentAt: new Date(),
          lastErrorCode: null,
          lastHttpStatus: null,
        },
      });
      if (contactId !== crmContactId) {
        await tx.lead.update({
          where: { id: event.leadId },
          data: { crmContactId: contactId },
        });
      }
      await this.record(tx, 'CRM_SYNC_SENT', event, { attempts });
    } catch (error) {
      await this.fail(tx, event, attempts, error);
    }
  }

  /** Programa el próximo intento o, si no quedan, lo deja `FAILED`. */
  private async fail(
    tx: Prisma.TransactionClient,
    event: ClaimedEvent,
    attempts: number,
    error: unknown,
  ) {
    let code: CrmSyncErrorCode = CrmSyncErrorCode.PROVIDER_ERROR;
    let httpStatus: number | null = null;
    let retryAfterMs = 0;
    if (error instanceof CrmAdapterError) {
      code = error.code;
      // Lo que no cabe en el CHECK de la base no se guarda (ver `contactId`).
      httpStatus =
        Number.isInteger(error.httpStatus) &&
        error.httpStatus! >= 100 &&
        error.httpStatus! <= 599
          ? error.httpStatus!
          : null;
      retryAfterMs = Math.min(
        Math.max(error.retryAfterMs ?? 0, 0),
        MAX_RETRY_AFTER_MS,
      );
    } else {
      // Un error inesperado (de código, no del CRM): solo el nombre, nunca el
      // mensaje, que podría traer datos del lead.
      this.logger.error(
        `Error inesperado al enviar el evento ${event.id} al CRM: ${errorName(error)}`,
      );
    }

    const final = !RETRYABLE.has(code) || attempts >= MAX_ATTEMPTS;
    const wait = Math.max(
      BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
      retryAfterMs,
    );
    await tx.crmSyncEvent.update({
      where: { id: event.id },
      data: {
        status: final ? CrmSyncEventStatus.FAILED : CrmSyncEventStatus.PENDING,
        attempts,
        lastErrorCode: code,
        lastHttpStatus: httpStatus,
        ...(!final && { nextAttemptAt: new Date(Date.now() + wait) }),
      },
    });
    this.logger.warn(
      `CRM: el evento ${event.id} (${event.type}) falló con ${code}` +
        (final ? ', queda fallido' : `, se reintenta en ${wait / 1000} s`),
    );
    if (final) {
      await this.record(tx, 'CRM_SYNC_FAILED', event, { attempts, code });
    }
  }

  /** Ids y códigos, nunca datos del lead ni del proveedor. */
  private record(
    tx: Prisma.TransactionClient,
    action: string,
    event: ClaimedEvent,
    data: Prisma.InputJsonObject,
  ) {
    return this.audit.record(
      {
        actorType: AuditActorType.SYSTEM,
        action,
        entity: 'CrmSyncEvent',
        entityId: event.id,
        data: { leadId: event.leadId, type: event.type, ...data },
      },
      tx,
    );
  }

  /** Eventos de un lead, del más reciente al más antiguo. 404 si no existe. */
  async listEvents(
    leadId: string,
    page: number,
    pageSize: number,
  ): Promise<CrmSyncEventsPage> {
    const where = { leadId };
    const [lead, data, total] = await this.prisma.$transaction([
      this.prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true },
      }),
      this.prisma.crmSyncEvent.findMany({
        where,
        select: EVENT_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmSyncEvent.count({ where }),
    ]);
    if (!lead) throw new NotFoundException(`Lead ${leadId} no encontrado`);
    return { data, total, page, pageSize };
  }

  /**
   * Vuelve a poner en cola un evento fallido, con los intentos desde cero.
   * 404 si el evento no es de ese lead; 409 si no está fallido (repetir el
   * reintento no duplica nada).
   */
  async retry(
    leadId: string,
    eventId: string,
    actorId: string,
  ): Promise<CrmSyncEventView> {
    const event = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.crmSyncEvent.updateMany({
        where: { id: eventId, leadId, status: CrmSyncEventStatus.FAILED },
        data: {
          status: CrmSyncEventStatus.PENDING,
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      });
      const current = await tx.crmSyncEvent.findFirst({
        where: { id: eventId, leadId },
        select: EVENT_SELECT,
      });
      if (!current) {
        throw new NotFoundException(`Evento ${eventId} no encontrado`);
      }
      if (count === 0) {
        throw new ConflictException({
          message:
            'Este envío no está fallido: ya se está procesando o ya salió.',
          code: CRM_SYNC_EVENT_NOT_FAILED,
        });
      }
      await this.audit.record(
        {
          actorType: AuditActorType.PANEL_USER,
          actorId,
          action: 'CRM_SYNC_RETRIED',
          entity: 'CrmSyncEvent',
          entityId: eventId,
          data: { leadId, type: current.type },
        },
        tx,
      );
      return current;
    });
    this.kick();
    return event;
  }

  /** Estado general de varios leads en una sola consulta (sin N+1). */
  async syncStatusByLead(
    leadIds: string[],
  ): Promise<Map<string, CrmSyncStatus | null>> {
    const rows =
      leadIds.length === 0
        ? []
        : await this.prisma.crmSyncEvent.groupBy({
            by: ['leadId', 'status'],
            where: { leadId: { in: leadIds } },
            _count: { _all: true },
          });
    const counts = new Map<
      string,
      Partial<Record<CrmSyncEventStatus, number>>
    >();
    for (const row of rows) {
      const byStatus = counts.get(row.leadId) ?? {};
      byStatus[row.status] = row._count._all;
      counts.set(row.leadId, byStatus);
    }
    return new Map(
      leadIds.map((id) => [id, syncStatusOf(counts.get(id) ?? {})]),
    );
  }
}

/** Filtro de leads por estado general, en la base. */
export function leadSyncStatusWhere(
  status: CrmSyncStatus,
): Prisma.LeadWhereInput {
  const { FAILED, PENDING, SENT } = CrmSyncEventStatus;
  switch (status) {
    case 'FAILED':
      return { crmSyncEvents: { some: { status: FAILED } } };
    case 'PENDING':
      return {
        AND: [
          { crmSyncEvents: { some: { status: PENDING } } },
          { crmSyncEvents: { none: { status: FAILED } } },
        ],
      };
    case 'SYNCED':
      return {
        AND: [
          { crmSyncEvents: { some: { status: SENT } } },
          { crmSyncEvents: { none: { status: { in: [PENDING, FAILED] } } } },
        ],
      };
  }
}

function createAdapter(
  provider: CrmProviderName,
  forcedFailure: CrmSyncErrorCode | undefined,
): CrmAdapter {
  switch (provider) {
    case 'simulated':
      return new SimulatedCrmAdapter(forcedFailure);
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
