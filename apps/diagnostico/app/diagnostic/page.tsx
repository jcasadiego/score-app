import { redirect } from "next/navigation";
import { Alert } from "@/components/ui";
import { callApi } from "@/lib/api/client";
import type { CurrentDiagnostic } from "@/lib/api/types";
import { ALREADY_SUBMITTED_URL, ROUTES, recoverUrl } from "@/lib/routes";
import { getSession } from "@/lib/session/cookie";
import { Questionnaire } from "./questionnaire";

export const metadata = { title: "Tu diagnóstico — SCORE" };

export default async function DiagnosticPage() {
  const session = await getSession();
  if (!session) redirect(recoverUrl("session"));

  const result = await callApi<CurrentDiagnostic>(
    "/diagnostic-sessions/current",
    { session },
  );
  if (!result.ok) {
    if (result.status === 401) redirect(ROUTES.sessionEnded);
    return (
      <main className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Tu diagnóstico</h1>
        <Alert tone="danger" announce title="No pudimos cargar tu diagnóstico">
          {result.message} Recarga la página en unos segundos.
        </Alert>
      </main>
    );
  }
  if (result.data.status === "COMPLETED") redirect(ALREADY_SUBMITTED_URL);

  return <Questionnaire diagnostic={result.data} />;
}
