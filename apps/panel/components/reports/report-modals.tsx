"use client";

import { useState, useTransition } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Spin,
  Tag,
  Typography,
} from "antd";
import type { ApprovalBlocker } from "@/lib/api/reviews";
import type { Report, ReportSection, SectionRevision } from "@/lib/api/reports";
import {
  REPORT_PART_LABELS,
  REPORT_REOPEN_REASON_MAX,
  REPORT_SECTION_BODY_MAX,
} from "@/lib/reports/labels";
import { LocalDate } from "@/components/local-date";
import {
  deliverReportAction,
  editSectionAction,
  reopenReportAction,
  type ReportActionResult,
} from "@/app/(panel)/reviews/[id]/report/actions";

const EDIT_FORM = "edit-section-form";
const REOPEN_FORM = "reopen-report-form";

/** Texto de la IA o de una persona: siempre texto plano, con sus saltos de línea. */
export function SectionBody({ body }: { body: string }) {
  return (
    <Typography.Paragraph
      style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 0 }}
    >
      {body}
    </Typography.Paragraph>
  );
}

/** Quién escribió la versión vigente: la IA (a pedido de alguien) o una persona. */
export function SourceTag({ source }: { source: "AI" | "HUMAN" }) {
  return source === "AI" ? (
    <Tag color="purple" style={{ marginInlineEnd: 0 }}>
      Redactado por IA
    </Tag>
  ) : (
    <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
      Editado a mano
    </Tag>
  );
}

/**
 * Edita una sección. `version` llega de las props: si otra persona cambió el
 * informe (412), la pantalla recarga y el modal sigue abierto con lo escrito,
 * listo para guardar sobre la versión nueva.
 */
export function EditSectionModal({
  reviewId,
  section,
  version,
  onDone,
  onCancel,
}: {
  reviewId: string;
  section: ReportSection;
  version: number;
  onDone: (result: ReportActionResult) => void;
  onCancel: () => void;
}) {
  const [saving, startSaving] = useTransition();

  function submit({ body }: { body: string }) {
    startSaving(async () => {
      onDone(await editSectionAction(reviewId, section.id, version, body));
    });
  }

  return (
    <Modal
      open
      width={720}
      title={`${section.dimension} · ${REPORT_PART_LABELS[section.part]}`}
      onCancel={() => !saving && onCancel()}
      mask={{ closable: !saving }}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>,
        <Button key="submit" type="primary" htmlType="submit" form={EDIT_FORM} loading={saving}>
          Guardar
        </Button>,
      ]}
    >
      <Form
        id={EDIT_FORM}
        layout="vertical"
        initialValues={{ body: section.body }}
        onFinish={submit}
        disabled={saving}
      >
        <Form.Item
          name="body"
          label="Texto"
          rules={[{ required: true, whitespace: true, message: "Escribe el texto." }]}
        >
          <Input.TextArea
            autoSize={{ minRows: 6, maxRows: 18 }}
            maxLength={REPORT_SECTION_BODY_MAX}
            showCount
            autoFocus
          />
        </Form.Item>
        <Typography.Text type="secondary">
          La versión anterior queda en el historial.
        </Typography.Text>
      </Form>
    </Modal>
  );
}

/** Historial de una sección, de la versión más reciente a la más antigua. */
export function HistoryModal({
  section,
  revisions,
  error,
  onClose,
}: {
  section: ReportSection;
  /** Nulo mientras carga. */
  revisions: SectionRevision[] | null;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      width={720}
      title={`Historial · ${section.dimension} · ${REPORT_PART_LABELS[section.part]}`}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Cerrar</Button>}
    >
      {error ? (
        <Alert type="error" showIcon title={error} />
      ) : revisions === null ? (
        <Flex justify="center" style={{ padding: 24 }}>
          <Spin />
        </Flex>
      ) : revisions.length === 0 ? (
        <Empty description="Sin versiones" />
      ) : (
        <Flex vertical gap={16}>
          {revisions.map((revision) => (
            <Flex key={revision.id} vertical gap={4}>
              <Flex gap={8} wrap align="center">
                <Typography.Text strong>Versión {revision.sequence}</Typography.Text>
                <SourceTag source={revision.source} />
                <Typography.Text type="secondary">
                  {revision.source === "AI" ? "pedido por" : "por"} {revision.author.name} ·{" "}
                  <LocalDate iso={revision.createdAt} />
                </Typography.Text>
              </Flex>
              <SectionBody body={revision.body} />
            </Flex>
          ))}
        </Flex>
      )}
    </Modal>
  );
}

/**
 * Entregar el informe o reenviar el enlace (solo el Aprobador). Muestra a qué
 * correo sale antes de confirmar. Si el caso tiene pendientes (409), los lista
 * sin cerrar.
 */
export function DeliverModal({
  report,
  recipient,
  onDone,
  onCancel,
}: {
  report: Report;
  /** Nulo mientras carga; `error` si no se pudo cargar. */
  recipient: { name: string; email: string } | { error: string } | null;
  onDone: (result: ReportActionResult) => void;
  onCancel: () => void;
}) {
  const [sending, startSending] = useTransition();
  const [blockers, setBlockers] = useState<ApprovalBlocker[] | null>(null);
  const resend = report.status === "DELIVERED";

  function send() {
    startSending(async () => {
      const result = await deliverReportAction(report.reviewId, report.version);
      if (result.blockers) {
        setBlockers(result.blockers);
        return;
      }
      onDone(result);
    });
  }

  return (
    <Modal
      open
      title={
        resend
          ? "¿Reenviar el enlace al cliente?"
          : report.redeliveryPending
            ? "¿Entregar la versión actualizada?"
            : "¿Entregar el informe al cliente?"
      }
      onCancel={() => !sending && onCancel()}
      mask={{ closable: !sending }}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={sending}>
          Cancelar
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={sending}
          disabled={
            (blockers !== null && blockers.length > 0) ||
            !recipient ||
            "error" in recipient
          }
          onClick={send}
        >
          {resend ? "Reenviar enlace" : "Entregar"}
        </Button>,
      ]}
    >
      <Flex vertical gap={12}>
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          {resend
            ? "Le llega un correo con un enlace nuevo de descarga. El enlace anterior deja de funcionar."
            : report.redeliveryPending
              ? "El cliente recibe la versión actualizada con un enlace nuevo. El correo le avisa que su informe cambió."
              : "El cliente recibe un correo con un enlace para descargar el PDF, sin crear usuario ni contraseña."}
        </Typography.Paragraph>
        {recipient === null ? (
          <Flex justify="center" style={{ padding: 12 }}>
            <Spin />
          </Flex>
        ) : "error" in recipient ? (
          <Alert type="error" showIcon title={recipient.error} />
        ) : (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Cliente">
              <span style={{ overflowWrap: "anywhere" }}>{recipient.name}</span>
            </Descriptions.Item>
            <Descriptions.Item label="Correo">
              <span style={{ overflowWrap: "anywhere" }}>{recipient.email}</span>
            </Descriptions.Item>
          </Descriptions>
        )}
        {blockers && blockers.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title="El caso tiene pendientes y no se puede enviar:"
            description={
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {blockers.map((blocker) => (
                  <li key={blocker.code}>{blocker.message}</li>
                ))}
              </ul>
            }
          />
        )}
      </Flex>
    </Modal>
  );
}

/** Devuelve a borrador un informe aprobado y sin entregar, con motivo (solo el Aprobador). */
export function ReopenReportModal({
  report,
  onDone,
  onCancel,
}: {
  report: Report;
  onDone: (result: ReportActionResult) => void;
  onCancel: () => void;
}) {
  const [saving, startSaving] = useTransition();

  function submit({ reason }: { reason: string }) {
    startSaving(async () => {
      onDone(await reopenReportAction(report.reviewId, report.version, reason));
    });
  }

  return (
    <Modal
      open
      title="Reabrir el informe"
      onCancel={() => !saving && onCancel()}
      mask={{ closable: !saving }}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>,
        <Button
          key="submit"
          type="primary"
          danger
          htmlType="submit"
          form={REOPEN_FORM}
          loading={saving}
        >
          Reabrir
        </Button>,
      ]}
    >
      <Form
        id={REOPEN_FORM}
        layout="vertical"
        initialValues={{ reason: "" }}
        onFinish={submit}
        disabled={saving}
      >
        <Typography.Paragraph>
          El informe vuelve a borrador para corregirlo y habrá que aprobarlo de
          nuevo. La aprobación del caso no cambia.
        </Typography.Paragraph>
        <Form.Item
          name="reason"
          label="Motivo (obligatorio)"
          rules={[
            { required: true, whitespace: true, message: "Escribe por qué lo reabres." },
          ]}
        >
          <Input.TextArea rows={3} maxLength={REPORT_REOPEN_REASON_MAX} showCount autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}
