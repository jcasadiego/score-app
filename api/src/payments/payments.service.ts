import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import {
  AuditActorType,
  CurrencyCode,
  DiagnosticActivationType,
  LeadStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../generated/prisma/enums';
import { AuditService } from '../audit/audit.service';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';
import { DIAGNOSTIC_ALREADY_EXISTS } from '../diagnostics/diagnostic-view';
import { PrismaService } from '../prisma/prisma.service';
import { assertVersion } from '../reviews/etag';

export const PAYMENT_NOT_PENDING = 'PAYMENT_NOT_PENDING';
export const PAYMENT_PENDING_EXISTS = 'PAYMENT_PENDING_EXISTS';
export const PAYMENT_REFERENCE_DUPLICATE = 'PAYMENT_REFERENCE_DUPLICATE';
export const PAYMENT_VERSION_MISMATCH = 'PAYMENT_VERSION_MISMATCH';
export const NO_CONFIRMED_PAYMENT = 'NO_CONFIRMED_PAYMENT';
export const LEAD_PAYMENTS_CHANGED = 'LEAD_PAYMENTS_CHANGED';

/** Índices únicos parciales de la migración de PF-51. */
const PENDING_INDEX = 'payments_one_pending_per_lead';
const REFERENCE_INDEX = 'payments_method_reference_key';

const PERSON = { select: { id: true, name: true } } as const;

const PAYMENT_SELECT = {
  id: true,
  amount: true,
  currency: true,
  method: true,
  reference: true,
  paidAt: true,
  status: true,
  version: true,
  createdAt: true,
  confirmedAt: true,
  voidedAt: true,
  voidReason: true,
  // Sin el correo: la pantalla de pagos no lo necesita (minimización).
  lead: { select: { id: true, name: true } },
  registeredBy: PERSON,
  confirmedBy: PERSON,
  voidedBy: PERSON,
} satisfies Prisma.PaymentSelect;

type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

/**
 * El monto viaja como string con 2 decimales: un número de JSON pierde
 * precisión. La versión no va en el cuerpo: viaja en el `ETag`.
 */
function view(row: PaymentRow) {
  const { amount, ...rest } = row;
  const body: Omit<PaymentRow, 'amount' | 'version'> &
    Partial<Pick<PaymentRow, 'version'>> = { ...rest };
  delete body.version;
  return { ...body, amount: amount.toFixed(2) };
}

export type PaymentView = ReturnType<typeof view>;

export interface PaymentsPage {
  data: PaymentView[];
  total: number;
  page: number;
  pageSize: number;
}

interface ListParams {
  page: number;
  pageSize: number;
  status?: PaymentStatus;
  method?: PaymentMethod;
  currency?: CurrencyCode;
  leadId?: string;
  paidFrom?: string;
  paidTo?: string;
}

export interface NewPayment {
  leadId: string;
  amount: string;
  currency: CurrencyCode;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
}

export interface LeadPaymentSummary {
  leadId: string;
  /** Total confirmado por moneda: sin tasa de cambio, no se suman entre sí. */
  confirmedTotals: { currency: CurrencyCode; amount: string }[];
  confirmedCount: number;
  pendingPaymentId: string | null;
  diagnostic: { id: string; activationType: DiagnosticActivationType } | null;
}

/** Nombre del índice único que violó la escritura, si fue un P2002. */
function violatedIndex(error: unknown): string | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return null;
  }
  const detail = JSON.stringify(error.meta ?? {}) + error.message;
  if (detail.includes(PENDING_INDEX)) return PENDING_INDEX;
  if (detail.includes(REFERENCE_INDEX)) return REFERENCE_INDEX;
  return 'unknown';
}

const pendingExists = () =>
  new ConflictException({
    message:
      'El lead ya tiene un pago pendiente. Confírmalo o anúlalo antes de registrar otro.',
    code: PAYMENT_PENDING_EXISTS,
  });

const referenceDuplicate = () =>
  new ConflictException({
    message: 'Ya hay un pago con ese método y esa referencia.',
    code: PAYMENT_REFERENCE_DUPLICATE,
  });

/**
 * Pagos registrados a mano (PF-51), solo del Aprobador. Confirmar verifica el
 * cobro; activar el diagnóstico es aparte y exige al menos un pago confirmado.
 * El monto y la referencia nunca entran a la bitácora: solo ids y estados.
 *
 * Orden de bloqueo en toda escritura que mira los pagos de un lead: primero la
 * fila del lead, después la del pago. Así, confirmar y activar no se cruzan.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly diagnostics: DiagnosticsService,
  ) {}

  async register(input: NewPayment, actorId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockLead(tx, input.leadId);
        const pending = await tx.payment.findFirst({
          where: { leadId: input.leadId, status: PaymentStatus.PENDING },
          select: { id: true },
        });
        if (pending) throw pendingExists();

        const payment = await tx.payment.create({
          data: {
            leadId: input.leadId,
            amount: new Prisma.Decimal(input.amount),
            currency: input.currency,
            method: input.method,
            reference: input.reference,
            paidAt: new Date(input.paidAt),
            registeredById: actorId,
          },
          select: PAYMENT_SELECT,
        });
        await this.audit.record(
          {
            actorType: AuditActorType.PANEL_USER,
            actorId,
            action: 'PAYMENT_REGISTERED',
            entity: 'Payment',
            entityId: payment.id,
            data: { leadId: input.leadId, status: PaymentStatus.PENDING },
          },
          tx,
        );
        return { payment: view(payment), version: payment.version };
      });
    } catch (error) {
      const index = violatedIndex(error);
      if (index === PENDING_INDEX) throw pendingExists();
      if (index === REFERENCE_INDEX) throw referenceDuplicate();
      throw error;
    }
  }

  async list({
    page,
    pageSize,
    status,
    method,
    currency,
    leadId,
    paidFrom,
    paidTo,
  }: ListParams): Promise<PaymentsPage> {
    const where: Prisma.PaymentWhereInput = {
      ...(status && { status }),
      ...(method && { method }),
      ...(currency && { currency }),
      ...(leadId && { leadId }),
      ...((paidFrom || paidTo) && {
        paidAt: {
          ...(paidFrom && { gte: new Date(paidFrom) }),
          ...(paidTo && { lt: new Date(paidTo) }),
        },
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        select: PAYMENT_SELECT,
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { data: rows.map(view), total, page, pageSize };
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      select: PAYMENT_SELECT,
    });
    if (!payment) throw this.notFound(id);
    return { payment: view(payment), version: payment.version };
  }

  /** Verifica el cobro. No crea el diagnóstico ni reenvía enlaces. */
  confirm(id: string, expectedVersion: number, actorId: string) {
    return this.transition(id, expectedVersion, actorId, {
      status: PaymentStatus.CONFIRMED,
      confirmedById: actorId,
      confirmedAt: new Date(),
    });
  }

  /** Anula un pago pendiente. El motivo no entra a la bitácora. */
  void(id: string, reason: string, expectedVersion: number, actorId: string) {
    return this.transition(id, expectedVersion, actorId, {
      status: PaymentStatus.VOIDED,
      voidedById: actorId,
      voidedAt: new Date(),
      voidReason: reason,
    });
  }

  /**
   * Lo que el Aprobador ve antes de activar el diagnóstico. El ETag es la
   * cantidad de pagos confirmados: solo crece (un confirmado no se anula), así
   * que si cambia entre ver y activar, hay un cobro que no vio.
   */
  async leadSummary(leadId: string): Promise<LeadPaymentSummary> {
    // Una sola transacción: el total, el conteo (ETag) y el pendiente salen de
    // la misma foto.
    const { lead, totals, pending } = await this.prisma.$transaction(
      async (tx) => ({
        lead: await tx.lead.findUnique({
          where: { id: leadId },
          select: {
            id: true,
            diagnostic: { select: { id: true, activationType: true } },
          },
        }),
        totals: await tx.payment.groupBy({
          by: ['currency'],
          where: { leadId, status: PaymentStatus.CONFIRMED },
          orderBy: { currency: 'asc' },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        pending: await tx.payment.findFirst({
          where: { leadId, status: PaymentStatus.PENDING },
          select: { id: true },
        }),
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (!lead) throw new NotFoundException(`Lead ${leadId} no encontrado`);

    return {
      leadId,
      confirmedTotals: totals.map((row) => ({
        currency: row.currency,
        amount: (row._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      })),
      confirmedCount: totals.reduce((sum, row) => sum + row._count._all, 0),
      pendingPaymentId: pending?.id ?? null,
      diagnostic: lead.diagnostic,
    };
  }

  /**
   * Activa el diagnóstico de un lead con pago: lo crea, emite el enlace, pasa
   * el lead a `CONVERTED` y envía el correo después del commit (si falla,
   * `emailSent: false`). Exige al menos un pago confirmado y que el Aprobador
   * haya visto todos (`expectedConfirmedCount`, del ETag del resumen).
   */
  activateDiagnostic(
    leadId: string,
    expectedConfirmedCount: number,
    actorId: string,
  ) {
    return this.diagnostics.activate(
      leadId,
      { type: DiagnosticActivationType.PAID },
      actorId,
      async (tx) => {
        await this.lockLead(tx, leadId);
        const existing = await tx.diagnostic.findUnique({
          where: { leadId },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException({
            message: 'El lead ya tiene un diagnóstico.',
            code: DIAGNOSTIC_ALREADY_EXISTS,
          });
        }
        const confirmed = await tx.payment.count({
          where: { leadId, status: PaymentStatus.CONFIRMED },
        });
        if (confirmed === 0) {
          throw new ConflictException({
            message:
              'El lead no tiene pagos confirmados: confirma uno antes de activar el diagnóstico.',
            code: NO_CONFIRMED_PAYMENT,
          });
        }
        assertVersion(confirmed, expectedConfirmedCount, {
          code: LEAD_PAYMENTS_CHANGED,
          message:
            'Los pagos confirmados del lead cambiaron desde que los viste. Vuelve a cargarlos antes de activar.',
        });

        const { status } = await tx.lead.update({
          where: { id: leadId },
          data: { status: LeadStatus.CONVERTED },
          select: { status: true },
        });
        await this.audit.record(
          {
            actorType: AuditActorType.PANEL_USER,
            actorId,
            action: 'LEAD_STATUS_CHANGED',
            entity: 'Lead',
            entityId: leadId,
            data: { status },
          },
          tx,
        );
      },
    );
  }

  /**
   * Cambio de estado desde `PENDING`, con `If-Match`. Primero el estado (409)
   * y después la versión (412): un pago que ya no está pendiente no se puede
   * cambiar, aunque se pida con la versión vieja.
   */
  private async transition(
    id: string,
    expectedVersion: number,
    actorId: string,
    data: Prisma.PaymentUncheckedUpdateInput & { status: PaymentStatus },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [owner] = await tx.$queryRaw<{ lead_id: string }[]>`
        SELECT lead_id FROM payments WHERE id = ${id}
      `;
      if (!owner) throw this.notFound(id);
      await this.lockLead(tx, owner.lead_id);

      const [current] = await tx.$queryRaw<
        { status: PaymentStatus; version: number }[]
      >`
        SELECT status, version FROM payments WHERE id = ${id} FOR UPDATE
      `;
      if (current.status !== PaymentStatus.PENDING) {
        throw new ConflictException({
          message:
            current.status === PaymentStatus.CONFIRMED
              ? 'El pago ya está confirmado: no se puede cambiar.'
              : 'El pago está anulado: no se puede cambiar.',
          code: PAYMENT_NOT_PENDING,
        });
      }
      assertVersion(current.version, expectedVersion, {
        code: PAYMENT_VERSION_MISMATCH,
        message:
          'El pago cambió desde que lo abriste. Vuelve a cargarlo antes de cambiarlo.',
      });

      const payment = await tx.payment.update({
        where: { id },
        data: { ...data, version: { increment: 1 } },
        select: PAYMENT_SELECT,
      });
      await this.audit.record(
        {
          actorType: AuditActorType.PANEL_USER,
          actorId,
          action:
            data.status === PaymentStatus.CONFIRMED
              ? 'PAYMENT_CONFIRMED'
              : 'PAYMENT_VOIDED',
          entity: 'Payment',
          entityId: id,
          data: {
            leadId: owner.lead_id,
            from: PaymentStatus.PENDING,
            to: data.status,
          },
        },
        tx,
      );
      return { payment: view(payment), version: payment.version };
    });
  }

  /** Bloquea el lead (404 si no existe): ordena las escrituras de sus pagos. */
  private async lockLead(tx: Prisma.TransactionClient, leadId: string) {
    const [lead] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM leads WHERE id = ${leadId} FOR UPDATE
    `;
    if (!lead) throw new NotFoundException(`Lead ${leadId} no encontrado`);
  }

  private notFound(id: string) {
    return new NotFoundException(`Pago ${id} no encontrado`);
  }
}
