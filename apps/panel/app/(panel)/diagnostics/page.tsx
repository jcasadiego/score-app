import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import {
  listDiagnostics,
  type PaginatedDiagnostics,
} from "@/lib/api/diagnostics";
import { ApiError } from "@/lib/api/errors";
import { PageError } from "@/components/page-error";
import { isFamily } from "@/lib/leads/labels";
import { isDiagnosticStatus } from "@/lib/diagnostics/labels";
import { MAX_PAGE, PAGE_SIZE } from "@/lib/users/limits";
import { DiagnosticsScreen } from "@/components/diagnostics/diagnostics-screen";

export const metadata: Metadata = {
  title: "Diagnósticos · Panel SCORE",
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DiagnosticsPage({
  searchParams,
}: PageProps<"/diagnostics">) {
  const session = await verifySession();
  const params = await searchParams;

  const requestedPage = Number(firstValue(params.page));
  const page =
    Number.isInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= MAX_PAGE
      ? requestedPage
      : 1;
  const q = firstValue(params.q)?.trim().slice(0, 100) || undefined;
  // Valores desconocidos en la URL se ignoran en vez de mandarle un 400 a la API.
  const requestedFamily = firstValue(params.family);
  const family = isFamily(requestedFamily) ? requestedFamily : undefined;
  const requestedStatus = firstValue(params.status);
  const status = isDiagnosticStatus(requestedStatus)
    ? requestedStatus
    : undefined;

  let result: PaginatedDiagnostics;
  const token = await getToken();
  try {
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    result = await listDiagnostics(token, {
      page,
      pageSize: PAGE_SIZE,
      search: q,
      family,
      status,
    });
  } catch (error) {
    return (
      <PageError
        error={error}
        fallback="No pudimos cargar los diagnósticos. Intenta de nuevo."
      />
    );
  }

  return (
    <DiagnosticsScreen
      page={result}
      filters={{ q: q ?? "", family, status }}
      canGenerate={session.role === "ADMIN"}
    />
  );
}
