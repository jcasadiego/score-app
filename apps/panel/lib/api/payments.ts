import "server-only";
import { callApi, type ResourceMessages } from "./client";
import type { IssuedLink } from "./diagnostics";
import type {
  CurrencyCode,
  PaymentMethod,
  PaymentStatus,
} from "@/lib/payments/labels";

interface Person {
  id: string;
  name: string;
}

export interface Payment {
  id: string;
  /** Texto decimal con 2 decimales: nunca se convierte a número. */
  amount: string;
  currency: CurrencyCode;
  method: PaymentMethod;
  reference: string;
  paidAt: string;
  status: PaymentStatus;
  /** Va en `If-Match` al confirmar o anular. */
  version: number;
  createdAt: string;
  confirmedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  lead: Person;
  registeredBy: Person;
  confirmedBy: Person | null;
  voidedBy: Person | null;
}

export interface PaginatedPayments {
  data: Payment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaymentFilters {
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
  /** Va en `If-Match` al activar: los cobros que vio el Aprobador. */
  confirmedCount: number;
  pendingPaymentId: string | null;
  diagnostic: {
    id: string;
    activationType: "PAID" | "WITHOUT_PAYMENT";
  } | null;
}

export interface ActivatedDiagnostic extends IssuedLink {
  id: string;
}

const MESSAGES: ResourceMessages = {
  notFound: "No encontramos ese pago o ese lead. Puede que ya no exista.",
};

const ifMatch = (version: number) => ({ "If-Match": `"${version}"` });

/** Una página de pagos; filtros y conteo los resuelve la API. */
export function listPayments(
  token: string,
  filters: PaymentFilters,
): Promise<PaginatedPayments> {
  const params = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  for (const key of [
    "status",
    "method",
    "currency",
    "leadId",
    "paidFrom",
    "paidTo",
  ] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return callApi<PaginatedPayments>(token, `/payments?${params}`, MESSAGES);
}

export function registerPayment(
  token: string,
  payment: NewPayment,
): Promise<Payment> {
  return callApi<Payment>(token, "/payments", MESSAGES, {
    method: "POST",
    body: JSON.stringify(payment),
  });
}

export function confirmPayment(
  token: string,
  id: string,
  version: number,
): Promise<Payment> {
  return callApi<Payment>(
    token,
    `/payments/${encodeURIComponent(id)}/confirmation`,
    MESSAGES,
    { method: "POST", headers: ifMatch(version) },
  );
}

export function voidPayment(
  token: string,
  id: string,
  version: number,
  reason: string,
): Promise<Payment> {
  return callApi<Payment>(
    token,
    `/payments/${encodeURIComponent(id)}/voiding`,
    MESSAGES,
    {
      method: "POST",
      headers: ifMatch(version),
      body: JSON.stringify({ reason }),
    },
  );
}

export function getLeadPaymentSummary(
  token: string,
  leadId: string,
): Promise<LeadPaymentSummary> {
  return callApi<LeadPaymentSummary>(
    token,
    `/leads/${encodeURIComponent(leadId)}/payment-summary`,
    MESSAGES,
  );
}

/** Crea el diagnóstico pagado; responde el enlace una sola vez. */
export function activateDiagnostic(
  token: string,
  leadId: string,
  confirmedCount: number,
): Promise<ActivatedDiagnostic> {
  return callApi<ActivatedDiagnostic>(
    token,
    `/leads/${encodeURIComponent(leadId)}/diagnostic-activation`,
    MESSAGES,
    { method: "POST", headers: ifMatch(confirmedCount) },
  );
}
