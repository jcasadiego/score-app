import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/errors";
import { PageError } from "@/components/page-error";
import { DiagnosticDetail } from "@/components/diagnostics/diagnostic-detail";
import { recalculationOptions } from "@/lib/reviews/labels";
import {
  historyPageFrom,
  loadDiagnosticDetail,
  type DiagnosticDetailData,
} from "@/lib/diagnostics/load-detail";

export const metadata: Metadata = {
  title: "Diagnóstico · Panel SCORE",
};

/** La ruta que usa el aviso de diagnóstico completado (PF-22). */
export default async function DiagnosticPage({
  params,
  searchParams,
}: PageProps<"/diagnostics/[id]">) {
  const session = await verifySession();
  const { id } = await params;
  const historyPage = historyPageFrom((await searchParams).calcPage);

  let data: DiagnosticDetailData;
  const token = await getToken();
  try {
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    data = await loadDiagnosticDetail(token, id, historyPage);
  } catch (error) {
    return (
      <PageError
        error={error}
        fallback="No pudimos cargar el diagnóstico. Intenta de nuevo."
      />
    );
  }

  return (
    <DiagnosticDetail
      diagnostic={data.diagnostic}
      calculations={data.calculations}
      flags={data.flags}
      calculationOptions={recalculationOptions(
        data.diagnostic.review?.status === "APPROVED",
        session.role === "ADMIN",
      )}
    />
  );
}
