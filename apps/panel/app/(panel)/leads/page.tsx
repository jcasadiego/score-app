import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import { getLead, listLeads, type Lead, type PaginatedLeads } from "@/lib/api/leads";
import {
  getCrmStatus,
  listCrmSyncEvents,
  type CrmStatus,
  type PaginatedCrmSyncEvents,
} from "@/lib/api/crm";
import { ApiError } from "@/lib/api/errors";
import { PageError } from "@/components/page-error";
import { isLeadStatus, isFamily } from "@/lib/leads/labels";
import { isCrmSyncStatus } from "@/lib/crm/labels";
import { MAX_PAGE, PAGE_SIZE } from "@/lib/users/limits";
import { LeadsScreen, type LeadDetail } from "@/components/leads/leads-screen";

export const metadata: Metadata = {
  title: "Leads · Panel SCORE",
};

/** Un lead tiene a lo sumo un envío por paso del recorrido: casi siempre cabe. */
const CRM_PAGE_SIZE = 10;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pageParam(value: string | undefined): number {
  const requested = Number(value);
  return Number.isInteger(requested) && requested > 0 && requested <= MAX_PAGE
    ? requested
    : 1;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Lista de leads y, con `?lead=`, su detalle con los envíos al CRM (PF-81).
 * Los envíos y el estado del CRM se piden en paralelo con la lista; el lead
 * solo se pide aparte si no está en la página (p. ej. un enlace directo).
 */
export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const session = await verifySession();
  const params = await searchParams;

  const page = pageParam(firstValue(params.page));
  const q = firstValue(params.q)?.trim().slice(0, 100) || undefined;
  // Valores desconocidos en la URL se ignoran en vez de mandarle un 400 a
  // la API.
  const requestedFamily = firstValue(params.family);
  const family = isFamily(requestedFamily) ? requestedFamily : undefined;
  const requestedStatus = firstValue(params.status);
  const status = isLeadStatus(requestedStatus) ? requestedStatus : undefined;
  const requestedCrm = firstValue(params.crm);
  const crmSyncStatus = isCrmSyncStatus(requestedCrm) ? requestedCrm : undefined;
  const requestedLead = firstValue(params.lead);
  const leadId =
    requestedLead && requestedLead.length <= 64 ? requestedLead : undefined;
  const crmPage = pageParam(firstValue(params.crmPage));

  const token = await getToken();
  if (!token) {
    return (
      <PageError
        error={new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.")}
        fallback="No pudimos cargar los leads. Intenta de nuevo."
      />
    );
  }

  // Lo secundario no tumba la lista: cada parte falla por su cuenta.
  const [leadsResult, crmResult, eventsResult] = await Promise.allSettled([
    listLeads(token, {
      page,
      pageSize: PAGE_SIZE,
      search: q,
      family,
      status,
      crmSyncStatus,
    }),
    getCrmStatus(token),
    leadId
      ? listCrmSyncEvents(token, leadId, crmPage, CRM_PAGE_SIZE)
      : Promise.resolve(null),
  ]);

  if (leadsResult.status === "rejected") {
    return (
      <PageError
        error={leadsResult.reason}
        fallback="No pudimos cargar los leads. Intenta de nuevo."
      />
    );
  }
  const result: PaginatedLeads = leadsResult.value;
  const crm: CrmStatus | null =
    crmResult.status === "fulfilled" ? crmResult.value : null;

  let detail: LeadDetail | null = null;
  if (leadId) {
    let lead: Lead | null = result.data.find((l) => l.id === leadId) ?? null;
    let error: string | undefined;
    if (!lead) {
      try {
        lead = await getLead(token, leadId);
      } catch (e) {
        error = errorMessage(e, "No pudimos cargar el lead. Intenta de nuevo.");
      }
    }
    const events: PaginatedCrmSyncEvents | null =
      eventsResult.status === "fulfilled" ? eventsResult.value : null;
    detail = {
      leadId,
      lead,
      error,
      events,
      eventsError:
        eventsResult.status === "rejected"
          ? errorMessage(
              eventsResult.reason,
              "No pudimos cargar los envíos al CRM. Intenta de nuevo.",
            )
          : undefined,
    };
  }

  return (
    <LeadsScreen
      page={result}
      filters={{ q: q ?? "", family, status, crm: crmSyncStatus }}
      detail={detail}
      crm={crm}
      canGenerateDiagnostic={session.role === "ADMIN"}
      canManagePayments={session.role === "ADMIN"}
    />
  );
}
