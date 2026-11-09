"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Form, Input, Modal, Typography } from "antd";
import type { ApprovalBlocker, ReviewDetail } from "@/lib/api/reviews";
import { REVIEW_REASON_MAX } from "@/lib/reviews/labels";
import {
  approveReviewAction,
  reopenReviewAction,
  type ReviewActionResult,
} from "@/app/(panel)/reviews/actions";

const APPROVE_FORM = "approve-form";
const REOPEN_FORM = "reopen-form";

/**
 * Aprobar (solo el Aprobador). Si lo único que falta es el análisis con IA,
 * pide el motivo de la excepción. Si la API responde 409, muestra lo que
 * falta sin cerrar.
 */
export function ApproveModal({
  review,
  needsException,
  onDone,
  onCancel,
}: {
  review: ReviewDetail;
  needsException: boolean;
  onDone: (result: ReviewActionResult) => void;
  onCancel: () => void;
}) {
  const [saving, startSaving] = useTransition();
  const [blockers, setBlockers] = useState<ApprovalBlocker[] | null>(null);

  function submit({ reason }: { reason?: string }) {
    startSaving(async () => {
      const result = await approveReviewAction(
        review.id,
        review.version,
        review.diagnostic.id,
        reason ?? "",
      );
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
      title={needsException ? "Aprobar con excepción de IA" : "¿Aprobar el caso?"}
      onCancel={() => !saving && onCancel()}
      mask={{ closable: !saving }}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>,
        <Button
          key="submit"
          type="primary"
          htmlType="submit"
          form={APPROVE_FORM}
          loading={saving}
          disabled={blockers !== null && blockers.length > 0}
        >
          Aprobar
        </Button>,
      ]}
    >
      <Form
        id={APPROVE_FORM}
        layout="vertical"
        initialValues={{ reason: "" }}
        onFinish={submit}
        disabled={saving}
      >
        <Typography.Paragraph>
          La aprobación queda atada al resultado del motor que se ve en esta
          pantalla. Si alguien recalcula después, se anula.
          {needsException &&
            " Como el análisis con IA no terminó bien, explica por qué apruebas igual: queda registrado."}
        </Typography.Paragraph>
        {needsException && (
          <Form.Item
            name="reason"
            label="Motivo de la excepción (obligatorio)"
            rules={[
              { required: true, whitespace: true, message: "Escribe el motivo." },
            ]}
          >
            <Input.TextArea rows={3} maxLength={REVIEW_REASON_MAX} showCount autoFocus />
          </Form.Item>
        )}
        {blockers && blockers.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title="El caso cambió y todavía no se puede aprobar:"
            description={
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {blockers.map((blocker) => (
                  <li key={blocker.code}>{blocker.message}</li>
                ))}
              </ul>
            }
          />
        )}
      </Form>
    </Modal>
  );
}

/** Reabrir una aprobación con motivo (solo el Aprobador). */
export function ReopenModal({
  review,
  onDone,
  onCancel,
}: {
  review: ReviewDetail;
  onDone: (result: ReviewActionResult) => void;
  onCancel: () => void;
}) {
  const [saving, startSaving] = useTransition();

  function submit({ reason }: { reason: string }) {
    startSaving(async () => {
      onDone(await reopenReviewAction(review.id, review.diagnostic.id, reason));
    });
  }

  return (
    <Modal
      open
      title="Reabrir el caso"
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
          La aprobación se anula y el caso vuelve a revisión: se podrá corregir
          y habrá que aprobarlo de nuevo.
        </Typography.Paragraph>
        <Form.Item
          name="reason"
          label="Motivo (obligatorio)"
          rules={[
            { required: true, whitespace: true, message: "Escribe por qué lo reabres." },
          ]}
        >
          <Input.TextArea rows={3} maxLength={REVIEW_REASON_MAX} showCount autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}
