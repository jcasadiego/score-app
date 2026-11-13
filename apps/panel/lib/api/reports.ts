import "server-only";
import { callApi, type ResourceMessages } from "./client";
import { ApiError } from "./errors";
import type { ReportPart, ReportStatus } from "@/lib/reports/labels";

type Person = { id: string; name: string };

export interface ReportSection {
  id: string;
  dimension: string;
  part: ReportPart;
  /** Texto de la IA o de una persona: se muestra siempre como texto plano. */
  body: string;
  source: "AI" | "HUMAN";
  sequence: number;
  author: Person;
  revisedAt: string;
}

export interface Report {
  id: string;
  reviewId: string;
  status: ReportStatus;
  /** Va en `If-Match` al editar, regenerar, aprobar, reabrir y entregar. */
  version: number;
  reviewApprovalId: string;
  createdAt: string;
  updatedAt: string;
  /** La primera entrega al cliente, si la hubo. */
  deliveredAt: string | null;
  redeliveryPending: boolean;
  /** El resultado del caso cambió desde que se redactó: hay que regenerarlo. */
  outdated: boolean;
  approval: {
    id: string;
    reportVersion: number;
    approvedBy: Person;
    approvedAt: string;
  } | null;
  sections: ReportSection[];
}

export interface SectionRevision {
  id: string;
  sequence: number;
  body: string;
  source: "AI" | "HUMAN";
  aiCallLogId: string | null;
  author: Person;
  createdAt: string;
}

export interface ReportDelivery {
  id: string;
  recipientEmail: string;
  pdfSha256: string;
  templateVersion: number;
  deliveredBy: Person;
  createdAt: string;
  link: {
    expiresAt: string;
    revokedAt: string | null;
    downloads: number;
    lastDownloadAt: string | null;
  };
}

export interface DeliveryResult {
  id: string;
  resend: boolean;
  updated: boolean;
  deliveredAt: string;
  linkExpiresAt: string;
}

const MESSAGES: ResourceMessages = {
  notFound: "No encontramos el informe de este caso. Puede que todavía no exista.",
};

export const reportPath = (reviewId: string) =>
  `/reviews/${encodeURIComponent(reviewId)}/report`;
const sectionPath = (reviewId: string, sectionId: string) =>
  `${reportPath(reviewId)}/sections/${encodeURIComponent(sectionId)}`;
const ifMatch = (version: number) => ({ "If-Match": `"${version}"` });

/** El informe del caso, o nulo si todavía no se generó (404). */
export async function getReport(
  token: string,
  reviewId: string,
): Promise<Report | null> {
  try {
    return await callApi<Report>(token, reportPath(reviewId), MESSAGES);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function generateReport(token: string, reviewId: string): Promise<Report> {
  return callApi(token, reportPath(reviewId), MESSAGES, { method: "POST" });
}

export function regenerateReport(
  token: string,
  reviewId: string,
  version: number,
): Promise<Report> {
  return callApi(token, `${reportPath(reviewId)}/regenerations`, MESSAGES, {
    method: "POST",
    headers: ifMatch(version),
  });
}

export function editSection(
  token: string,
  reviewId: string,
  sectionId: string,
  version: number,
  body: string,
): Promise<Report> {
  return callApi(token, sectionPath(reviewId, sectionId), MESSAGES, {
    method: "PUT",
    headers: ifMatch(version),
    body: JSON.stringify({ body }),
  });
}

export function regenerateSection(
  token: string,
  reviewId: string,
  sectionId: string,
  version: number,
): Promise<Report> {
  return callApi(
    token,
    `${sectionPath(reviewId, sectionId)}/regenerations`,
    MESSAGES,
    { method: "POST", headers: ifMatch(version) },
  );
}

export function listSectionRevisions(
  token: string,
  reviewId: string,
  sectionId: string,
): Promise<SectionRevision[]> {
  return callApi(token, `${sectionPath(reviewId, sectionId)}/revisions`, MESSAGES);
}

export function approveReport(
  token: string,
  reviewId: string,
  version: number,
): Promise<Report> {
  return callApi(token, `${reportPath(reviewId)}/approval`, MESSAGES, {
    method: "POST",
    headers: ifMatch(version),
  });
}

export function reopenReport(
  token: string,
  reviewId: string,
  version: number,
  reason: string,
): Promise<Report> {
  return callApi(token, `${reportPath(reviewId)}/reopenings`, MESSAGES, {
    method: "POST",
    headers: ifMatch(version),
    body: JSON.stringify({ reason }),
  });
}

export function listDeliveries(
  token: string,
  reviewId: string,
): Promise<ReportDelivery[]> {
  return callApi(token, `${reportPath(reviewId)}/deliveries`, MESSAGES);
}

export function deliverReport(
  token: string,
  reviewId: string,
  version: number,
): Promise<DeliveryResult> {
  return callApi(token, `${reportPath(reviewId)}/deliveries`, MESSAGES, {
    method: "POST",
    headers: ifMatch(version),
  });
}
