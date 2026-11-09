import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import {
  getReview,
  listCorrections,
  listNotes,
  type AnswerCorrection,
  type ReviewDetail,
  type ReviewNote,
} from "@/lib/api/reviews";
import { ApiError } from "@/lib/api/errors";
import { PageError } from "@/components/page-error";
import { ReviewScreen } from "@/components/reviews/review-screen";
import {
  historyPageFrom,
  loadDiagnosticDetail,
  type DiagnosticDetailData,
} from "@/lib/diagnostics/load-detail";

export const metadata: Metadata = {
  title: "Revisión · Panel SCORE",
};

export default async function ReviewPage({
  params,
  searchParams,
}: PageProps<"/reviews/[id]">) {
  const session = await verifySession();
  const { id } = await params;
  const historyPage = historyPageFrom((await searchParams).calcPage);

  let review: ReviewDetail;
  let detail: DiagnosticDetailData;
  let corrections: AnswerCorrection[];
  let notes: ReviewNote[];
  const token = await getToken();
  try {
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    review = await getReview(token, id);
    [detail, corrections, notes] = await Promise.all([
      loadDiagnosticDetail(token, review.diagnostic.id, historyPage),
      listCorrections(token, id),
      listNotes(token, id),
    ]);
  } catch (error) {
    return (
      <PageError
        error={error}
        fallback="No pudimos cargar el caso. Intenta de nuevo."
      />
    );
  }

  return (
    <ReviewScreen
      review={review}
      detail={detail}
      corrections={corrections}
      notes={notes}
      me={{ id: session.id, isApprover: session.role === "ADMIN" }}
    />
  );
}
