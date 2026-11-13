import type { Metadata } from "next";
import { verifySession } from "@/lib/auth/dal";
import { getToken } from "@/lib/auth/session";
import { getReview, type ReviewDetail } from "@/lib/api/reviews";
import {
  getReport,
  listDeliveries,
  type Report,
  type ReportDelivery,
} from "@/lib/api/reports";
import { ApiError } from "@/lib/api/errors";
import { PageError } from "@/components/page-error";
import { ReportScreen } from "@/components/reports/report-screen";
import type { DeliveryRow } from "@/components/reports/deliveries-card";

/** Estado del enlace de cada entrega, con la hora del servidor. */
function withLinkStatus(deliveries: ReportDelivery[]): DeliveryRow[] {
  const now = Date.now();
  return deliveries.map((delivery) => ({
    ...delivery,
    linkStatus: delivery.link.revokedAt
      ? "REVOKED"
      : new Date(delivery.link.expiresAt).getTime() <= now
        ? "EXPIRED"
        : "ACTIVE",
  }));
}

export const metadata: Metadata = {
  title: "Informe · Panel SCORE",
};

export default async function ReportPage({ params }: PageProps<"/reviews/[id]/report">) {
  const session = await verifySession();
  const { id } = await params;

  let review: ReviewDetail;
  let report: Report | null;
  let deliveries: DeliveryRow[] = [];
  const token = await getToken();
  try {
    if (!token) {
      throw new ApiError(401, "Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    // En paralelo: si el caso no existe, `getReview` falla con 404.
    [review, report] = await Promise.all([getReview(token, id), getReport(token, id)]);
    // Sin entregas previas no hay registro que pedir.
    if (report && (report.deliveredAt || report.status === "DELIVERED")) {
      deliveries = withLinkStatus(await listDeliveries(token, id));
    }
  } catch (error) {
    return (
      <PageError
        error={error}
        fallback="No pudimos cargar el informe. Intenta de nuevo."
      />
    );
  }

  return (
    <ReportScreen
      review={review}
      report={report}
      deliveries={deliveries}
      isApprover={session.role === "ADMIN"}
    />
  );
}
