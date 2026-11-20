import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/errors";
import { getLead } from "@/lib/api/leads";
import {
  getLeadPaymentSummary,
  listPayments,
  type LeadPaymentSummary,
  type PaginatedPayments,
} from "@/lib/api/payments";
import { PageError } from "@/components/page-error";
import { PaymentsScreen } from "@/components/payments/payments-screen";
import {
  isCurrency,
  isPaymentMethod,
  isPaymentStatus,
} from "@/lib/payments/labels";
import { MAX_PAGE, PAGE_SIZE } from "@/lib/users/limits";

export const metadata: Metadata = {
  title: "Pagos · Panel SCORE",
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Un instante RFC 3339 válido, o nada: la URL la puede escribir cualquiera. */
function instant(value: string | undefined): string | undefined {
  return value && !Number.isNaN(Date.parse(value)) && value.length <= 40
    ? new Date(value).toISOString()
    : undefined;
}

/**
 * Pagos (PF-52), solo del Aprobador: la API responde 403 al Revisor y la
 * pantalla lo muestra como "sin permiso". Con `leadId`, además, el resumen del
 * lead y la activación del diagnóstico.
 */
export default async function PaymentsPage({
  searchParams,
}: PageProps<"/payments">) {
  await verifySession();
  const params = await searchParams;

  const requestedPage = Number(firstValue(params.page));
  const page =
    Number.isInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= MAX_PAGE
      ? requestedPage
      : 1;
  // Valores desconocidos en la URL se ignoran en vez de mandarle un 400 a la API.
  const status = firstValue(params.status);
  const method = firstValue(params.method);
  const currency = firstValue(params.currency);
  const requestedLead = firstValue(params.leadId);
  const leadId =
    requestedLead && requestedLead.length <= 64 ? requestedLead : undefined;
  const filters = {
    status: isPaymentStatus(status) ? status : undefined,
    method: isPaymentMethod(method) ? method : undefined,
    currency: isCurrency(currency) ? currency : undefined,
    leadId,
    paidFrom: instant(firstValue(params.paidFrom)),
    paidTo: instant(firstValue(params.paidTo)),
  };

  let result: PaginatedPayments;
  let lead: {
    id: string;
    name: string;
    email: string;
    summary: LeadPaymentSummary;
  } | null = null;
  try {
    const token = await getToken();
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    const [payments, leadData, summary] = await Promise.all([
      listPayments(token, { page, pageSize: PAGE_SIZE, ...filters }),
      leadId ? getLead(token, leadId) : null,
      leadId ? getLeadPaymentSummary(token, leadId) : null,
    ]);
    result = payments;
    if (leadData && summary) {
      lead = {
        id: leadData.id,
        name: leadData.name,
        email: leadData.email,
        summary,
      };
    }
  } catch (error) {
    return (
      <PageError
        error={error}
        fallback="No pudimos cargar los pagos. Intenta de nuevo."
      />
    );
  }

  return <PaymentsScreen page={result} filters={filters} lead={lead} />;
}
