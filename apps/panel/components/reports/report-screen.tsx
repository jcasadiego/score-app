"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Card,
  Descriptions,
  Divider,
  Empty,
  Flex,
  Space,
  Typography,
} from "antd";
import type { ReviewDetail } from "@/lib/api/reviews";
import type { Report, ReportSection, SectionRevision } from "@/lib/api/reports";
import { REPORT_PART_LABELS, REPORT_PARTS, reportHref } from "@/lib/reports/labels";
import { LocalDate } from "@/components/local-date";
import { reviewHref } from "@/components/reviews/review-tags";
import {
  approveReportAction,
  generateReportAction,
  regenerateReportAction,
  regenerateSectionAction,
  sectionRevisionsAction,
  type ReportActionResult,
} from "@/app/(panel)/reviews/[id]/report/actions";
import { ReportStatusTag } from "./report-status-tag";
import { DeliveriesCard, type DeliveryRow } from "./deliveries-card";
import {
  DeliverModal,
  EditSectionModal,
  HistoryModal,
  ReopenReportModal,
  SectionBody,
  SourceTag,
} from "./report-modals";

type History = {
  section: ReportSection;
  revisions: SectionRevision[] | null;
  error: string | null;
};

/** Las secciones agrupadas por dimensión, en el orden que trae la API. */
function byDimension(sections: ReportSection[]) {
  const groups = new Map<string, ReportSection[]>();
  for (const section of sections) {
    const group = groups.get(section.dimension) ?? [];
    group.push(section);
    groups.set(section.dimension, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => REPORT_PARTS.indexOf(a.part) - REPORT_PARTS.indexOf(b.part));
  }
  return [...groups.entries()];
}

/**
 * Pantalla del informe (PF-43): generar, editar, aprobar y entregar. Ocultar
 * un botón no reemplaza la validación de la API, que decide con el rol leído
 * de la base (CLAUDE.md 5.3).
 */
export function ReportScreen({
  review,
  report,
  deliveries,
  recipient,
  isApprover,
}: {
  review: ReviewDetail;
  report: Report | null;
  deliveries: DeliveryRow[];
  recipient: { name: string; email: string };
  isApprover: boolean;
}) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const [busy, startBusy] = useTransition();
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  // Sube en cada apertura: cada modal monta un formulario nuevo (CLAUDE.md 9).
  const [openCount, setOpenCount] = useState(0);
  const [editing, setEditing] = useState<ReportSection | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [reopening, setReopening] = useState(false);

  const reviewApproved = review.status === "APPROVED";
  const draft = report?.status === "DRAFT";
  const editable = Boolean(report && draft && !report.outdated && reviewApproved);
  const leadName = review.diagnostic.leadName;

  function open(setter: () => void) {
    setOpenCount((n) => n + 1);
    setter();
  }

  /** 412: recarga los datos; el modal sigue abierto con lo escrito. */
  function handle(result: ReportActionResult, success: string): boolean {
    if (result.ok) {
      message.success(success);
      return true;
    }
    if (result.stale) {
      message.warning(result.error);
      router.refresh();
      return false;
    }
    message.error(result.error ?? "No pudimos completar la acción.");
    return false;
  }

  function run(label: string, action: () => Promise<ReportActionResult>, success: string) {
    setBusyLabel(label);
    startBusy(async () => {
      handle(await action(), success);
      setBusyLabel(null);
    });
  }

  function generate() {
    run("generate", () => generateReportAction(review.id), "Borrador generado.");
  }

  function regenerateAll() {
    if (!report) return;
    modal.confirm({
      title: "¿Regenerar todo el borrador con IA?",
      content:
        "La IA vuelve a redactar todas las secciones con el resultado vigente del caso. Las versiones actuales quedan en el historial.",
      okText: "Regenerar",
      cancelText: "Cancelar",
      onOk: () =>
        run(
          "regenerate",
          () => regenerateReportAction(review.id, report.version),
          "Borrador regenerado.",
        ),
    });
  }

  function regenerateOne(section: ReportSection) {
    if (!report) return;
    modal.confirm({
      title: `¿Regenerar ${section.dimension} · ${REPORT_PART_LABELS[section.part]} con IA?`,
      content: "La IA rehace solo esta parte, con las otras como contexto. El texto actual queda en el historial.",
      okText: "Regenerar",
      cancelText: "Cancelar",
      onOk: () =>
        run(
          section.id,
          () => regenerateSectionAction(review.id, section.id, report.version),
          "Sección regenerada.",
        ),
    });
  }

  function approve() {
    if (!report) return;
    modal.confirm({
      title: "¿Aprobar el informe?",
      content:
        "Se aprueba el texto tal como está ahora. Después no se puede editar, salvo que un Aprobador lo reabra antes de entregarlo.",
      okText: "Aprobar",
      cancelText: "Cancelar",
      onOk: () =>
        run("approve", () => approveReportAction(review.id, report.version), "Informe aprobado."),
    });
  }

  function showHistory(section: ReportSection) {
    setHistory({ section, revisions: null, error: null });
    startBusy(async () => {
      const result = await sectionRevisionsAction(review.id, section.id);
      setHistory((current) =>
        current?.section.id === section.id
          ? result.ok
            ? { section, revisions: result.revisions, error: null }
            : { section, revisions: null, error: result.error }
          : current,
      );
    });
  }

  const pdfHref = `${reportHref(review.id)}/pdf`;

  const header = (
    <Card
      title="Estado del informe"
      size="small"
      extra={<ReportStatusTag report={report && { status: report.status, redeliveryPending: report.redeliveryPending }} />}
    >
      <Flex vertical gap={16}>
        {report && (
          <Descriptions column={{ xs: 1, md: 2 }} size="small">
            <Descriptions.Item label="Generado">
              <LocalDate iso={report.createdAt} />
            </Descriptions.Item>
            <Descriptions.Item label="Último cambio">
              <LocalDate iso={report.updatedAt} />
            </Descriptions.Item>
            {report.approval && (
              <Descriptions.Item label="Aprobado">
                {report.approval.approvedBy.name}{" · "}<LocalDate iso={report.approval.approvedAt} />
              </Descriptions.Item>
            )}
            {report.deliveredAt && (
              <Descriptions.Item label="Primera entrega">
                <LocalDate iso={report.deliveredAt} />
              </Descriptions.Item>
            )}
          </Descriptions>
        )}

        <Space wrap size={8}>
          {!report && reviewApproved && (
            <Button type="primary" loading={busy && busyLabel === "generate"} disabled={busy} onClick={generate}>
              Generar borrador
            </Button>
          )}
          {report && (
            <Button href={pdfHref} target="_blank" rel="noopener">
              Vista previa del PDF
            </Button>
          )}
          {isApprover && editable && (
            <Button type="primary" disabled={busy} loading={busy && busyLabel === "approve"} onClick={approve}>
              Aprobar informe
            </Button>
          )}
          {isApprover && report?.status === "APPROVED" && (
            <>
              <Button type="primary" disabled={busy} onClick={() => open(() => setDelivering(true))}>
                {report.redeliveryPending ? "Entregar versión actualizada" : "Entregar al cliente"}
              </Button>
              <Button disabled={busy} onClick={() => open(() => setReopening(true))}>
                Reabrir informe
              </Button>
            </>
          )}
          {isApprover && report?.status === "DELIVERED" && (
            <Button disabled={busy} onClick={() => open(() => setDelivering(true))}>
              Reenviar enlace
            </Button>
          )}
        </Space>

        {!report && !reviewApproved && (
          <Alert
            type="info"
            showIcon
            title="El informe se genera cuando el caso está aprobado."
            description="Vuelve a la revisión del caso para terminarla."
          />
        )}
        {!report && reviewApproved && (
          <Typography.Text type="secondary">
            La IA redacta las cuatro partes de cada dimensión a partir del
            resultado aprobado. Puede tardar unos segundos.
          </Typography.Text>
        )}

        {report?.redeliveryPending && (
          <Alert
            type="warning"
            showIcon
            title="El cliente recibió una versión anterior."
            description="El caso cambió después de la entrega y el enlace del cliente quedó revocado. Pon el informe al día, apruébalo y entrégalo de nuevo."
          />
        )}
        {report && draft && report.outdated && (
          <Alert
            type="warning"
            showIcon
            title="El informe volvió a borrador porque el caso cambió."
            description={
              reviewApproved
                ? "El resultado del caso es otro desde que se redactó. Regenera el borrador antes de aprobarlo."
                : "El caso se reabrió o se recalculó. Cuando se apruebe de nuevo, regenera el borrador."
            }
            action={
              reviewApproved && (
                <Button
                  size="small"
                  loading={busy && busyLabel === "regenerate"}
                  disabled={busy}
                  onClick={regenerateAll}
                >
                  Regenerar todo
                </Button>
              )
            }
          />
        )}
        {report && draft && !report.outdated && !reviewApproved && (
          <Alert
            type="warning"
            showIcon
            title="El caso ya no está aprobado."
            description="No se puede editar ni aprobar el informe hasta que el caso se apruebe de nuevo."
          />
        )}
        {editable && !isApprover && (
          <Alert
            type="info"
            showIcon
            title="Pendiente de aprobación."
            description="Puedes editar y regenerar el texto. Un Aprobador lo aprueba y lo entrega."
          />
        )}
        {report?.status === "APPROVED" && !isApprover && (
          <Alert
            type="info"
            showIcon
            title="Aprobado: pendiente de entrega."
            description="Un Aprobador lo entrega al cliente."
          />
        )}
        {report?.status === "DELIVERED" && (
          <Alert
            type="success"
            showIcon
            title="Entregado al cliente."
            description="El texto ya no se puede cambiar. Si el caso se reabre o se recalcula, el informe vuelve a borrador para entregar una versión actualizada."
          />
        )}
      </Flex>
    </Card>
  );

  return (
    <Flex vertical gap={16}>
      <Breadcrumb
        items={[
          { title: <Link href="/reviews">Bandeja de revisión</Link> },
          { title: <Link href={reviewHref(review.id)}>{leadName}</Link> },
          { title: "Informe" },
        ]}
      />
      <Typography.Title
        level={3}
        style={{ margin: 0, letterSpacing: "-0.01em", overflowWrap: "anywhere" }}
      >
        Informe de {leadName}
      </Typography.Title>

      {header}

      {report &&
        (report.sections.length === 0 ? (
          <Card size="small">
            <Empty description="El informe no tiene secciones." />
          </Card>
        ) : (
          byDimension(report.sections).map(([dimension, sections]) => (
            <Card key={dimension} title={`Dimensión ${dimension}`} size="small">
              {sections.map((section, index) => (
                <div key={section.id}>
                  {index > 0 && <Divider style={{ margin: "12px 0" }} />}
                  <Flex vertical gap={8}>
                    <Flex justify="space-between" align="center" gap={8} wrap>
                      <Space size={8} wrap>
                        <Typography.Text strong>{REPORT_PART_LABELS[section.part]}</Typography.Text>
                        <SourceTag source={section.source} />
                        <Typography.Text type="secondary">
                          {section.source === "AI" ? "pedido por" : "por"} {section.author.name} ·{" "}
                          <LocalDate iso={section.revisedAt} />
                        </Typography.Text>
                      </Space>
                      <Space size={4} wrap>
                        {editable && (
                          <>
                            <Button size="small" disabled={busy} onClick={() => open(() => setEditing(section))}>
                              Editar
                            </Button>
                            <Button
                              size="small"
                              disabled={busy}
                              loading={busy && busyLabel === section.id}
                              onClick={() => regenerateOne(section)}
                            >
                              Regenerar con IA
                            </Button>
                          </>
                        )}
                        <Button size="small" type="link" onClick={() => showHistory(section)}>
                          Historial
                        </Button>
                      </Space>
                    </Flex>
                    <SectionBody body={section.body} />
                  </Flex>
                </div>
              ))}
            </Card>
          ))
        ))}

      {deliveries.length > 0 && <DeliveriesCard deliveries={deliveries} />}

      {editing && report && (
        <EditSectionModal
          key={`edit-${openCount}`}
          reviewId={review.id}
          section={editing}
          version={report.version}
          onDone={(result) => {
            if (handle(result, "Sección guardada.")) setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {history && (
        <HistoryModal
          section={history.section}
          revisions={history.revisions}
          error={history.error}
          onClose={() => setHistory(null)}
        />
      )}
      {delivering && report && (
        <DeliverModal
          key={`deliver-${openCount}`}
          report={report}
          recipient={recipient}
          onDone={(result) => {
            const success = result.delivery?.resend
              ? "Enlace reenviado al cliente."
              : result.delivery?.updated
                ? "Versión actualizada entregada al cliente."
                : "Informe entregado al cliente.";
            if (handle(result, success)) setDelivering(false);
          }}
          onCancel={() => setDelivering(false)}
        />
      )}
      {reopening && report && (
        <ReopenReportModal
          key={`reopen-${openCount}`}
          report={report}
          onDone={(result) => {
            if (handle(result, "Informe reabierto: volvió a borrador.")) setReopening(false);
          }}
          onCancel={() => setReopening(false)}
        />
      )}
    </Flex>
  );
}
