import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import {
  listReviews,
  type PaginatedReviews,
  type ReviewFilters,
} from "@/lib/api/reviews";
import { ApiError } from "@/lib/api/errors";
import { PageError } from "@/components/page-error";
import { ReviewsScreen } from "@/components/reviews/reviews-screen";
import { isReviewView, type ReviewView } from "@/lib/reviews/labels";
import { MAX_PAGE, PAGE_SIZE } from "@/lib/users/limits";

export const metadata: Metadata = {
  title: "Bandeja de revisión · Panel SCORE",
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const VIEW_FILTERS: Record<ReviewView, Partial<ReviewFilters>> = {
  unassigned: { assignment: "unassigned" },
  mine: { assignment: "mine" },
  approved: { status: "APPROVED" },
};

export default async function ReviewsPage({
  searchParams,
}: PageProps<"/reviews">) {
  const session = await verifySession();
  const params = await searchParams;

  const requestedPage = Number(firstValue(params.page));
  const page =
    Number.isInteger(requestedPage) &&
    requestedPage > 0 &&
    requestedPage <= MAX_PAGE
      ? requestedPage
      : 1;
  // Un valor desconocido en la URL se ignora en vez de mandarle un 400 a la API.
  const requestedView = firstValue(params.view);
  const view = isReviewView(requestedView) ? requestedView : undefined;

  let result: PaginatedReviews;
  const token = await getToken();
  try {
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    result = await listReviews(token, {
      page,
      pageSize: PAGE_SIZE,
      ...(view && VIEW_FILTERS[view]),
    });
  } catch (error) {
    return (
      <PageError
        error={error}
        fallback="No pudimos cargar la bandeja de revisión. Intenta de nuevo."
      />
    );
  }

  return (
    <ReviewsScreen
      page={result}
      view={view}
      me={{ id: session.id, isApprover: session.role === "ADMIN" }}
    />
  );
}
