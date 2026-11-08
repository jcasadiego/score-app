import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/errors";
import {
  getVersion,
  latestVersion,
  type QuestionnaireVersionDetail,
} from "@/lib/api/questionnaire";
import { FAMILIES, isFamily, type DiagnosticFamily } from "@/lib/leads/labels";
import { PageError } from "@/components/page-error";
import { QuestionnaireScreen } from "@/components/questionnaire/questionnaire-screen";

export const metadata: Metadata = {
  title: "Cuestionario · Panel SCORE",
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function QuestionnairePage({
  searchParams,
}: PageProps<"/questionnaire">) {
  const session = await verifySession();
  const params = await searchParams;
  const requested = firstValue(params.family);
  const family: DiagnosticFamily = isFamily(requested) ? requested : FAMILIES[0];
  const requestedView = firstValue(params.view);

  let draft: QuestionnaireVersionDetail | null;
  let published: QuestionnaireVersionDetail | null;
  try {
    const token = await getToken();
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    const [draftSummary, publishedSummary] = await Promise.all([
      latestVersion(token, family, "DRAFT"),
      latestVersion(token, family, "PUBLISHED"),
    ]);
    [draft, published] = await Promise.all([
      draftSummary ? getVersion(token, draftSummary.id) : null,
      publishedSummary ? getVersion(token, publishedSummary.id) : null,
    ]);
  } catch (error) {
    return (
      <PageError
        error={error}
        fallback="No pudimos cargar el cuestionario. Intenta de nuevo."
      />
    );
  }

  // Por defecto se ve el borrador, que es lo que se está trabajando.
  const view =
    requestedView === "published" && published
      ? "published"
      : draft
        ? "draft"
        : "published";

  return (
    <QuestionnaireScreen
      family={family}
      draft={draft}
      published={published}
      view={view}
      canEdit={session.role === "ADMIN"}
    />
  );
}
