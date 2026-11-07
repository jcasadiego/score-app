import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import { getDiagnostic, type DiagnosticDetail as Diagnostic } from "@/lib/api/diagnostics";
import { ApiError } from "@/lib/api/errors";
import { PageError } from "@/components/page-error";
import { DiagnosticDetail } from "@/components/diagnostics/diagnostic-detail";

export const metadata: Metadata = {
  title: "Diagnóstico · Panel SCORE",
};

/** La ruta que usa el aviso de diagnóstico completado (PF-22). */
export default async function DiagnosticPage({
  params,
}: PageProps<"/diagnostics/[id]">) {
  await verifySession();
  const { id } = await params;

  let diagnostic: Diagnostic;
  const token = await getToken();
  try {
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    diagnostic = await getDiagnostic(token, id);
  } catch (error) {
    return (
      <PageError
        error={error}
        fallback="No pudimos cargar el diagnóstico. Intenta de nuevo."
      />
    );
  }

  return <DiagnosticDetail diagnostic={diagnostic} />;
}
