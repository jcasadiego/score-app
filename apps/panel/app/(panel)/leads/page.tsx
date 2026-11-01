import type { Metadata } from "next";
import { Alert } from "antd";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import { listLeads, type PaginatedLeads } from "@/lib/api/leads";
import { ApiError } from "@/lib/api/errors";
import { isLeadStatus, isFamily } from "@/lib/leads/labels";
import { PAGE_SIZE } from "@/lib/users/limits";
import { LeadsScreen } from "@/components/leads/leads-screen";

export const metadata: Metadata = {
  title: "Leads · Panel SCORE",
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await verifySession();
  const params = await searchParams;

  const requestedPage = Number(firstValue(params.page));
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const q = firstValue(params.q)?.trim().slice(0, 100) || undefined;
  // Valores desconocidos en la URL se ignoran en vez de mandarle un 400 a
  // la API.
  const requestedFamily = firstValue(params.family);
  const family = isFamily(requestedFamily) ? requestedFamily : undefined;
  const requestedStatus = firstValue(params.status);
  const status = isLeadStatus(requestedStatus) ? requestedStatus : undefined;

  let result: PaginatedLeads;
  const token = await getToken();
  try {
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    result = await listLeads(token, {
      page,
      pageSize: PAGE_SIZE,
      search: q,
      family,
      status,
    });
  } catch (error) {
    const message =
      error instanceof ApiError
        ? error.message
        : "No pudimos cargar los leads. Intenta de nuevo.";
    return <Alert type="error" showIcon title={message} />;
  }

  return (
    <LeadsScreen page={result} filters={{ q: q ?? "", family, status }} />
  );
}
