"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Form, Input, Modal, Typography } from "antd";
import {
  activateDiagnosticAction,
  confirmPaymentAction,
  voidPaymentAction,
  type ActivationResult,
} from "@/app/(panel)/payments/actions";
import { resendAccessLinkAction } from "@/app/(panel)/diagnostics/actions";
import type { IssuedLink } from "@/lib/api/diagnostics";
import type { LeadPaymentSummary, Payment } from "@/lib/api/payments";
import {
  PAYMENT_METHOD_LABELS,
  VOID_REASON_MAX,
  VOID_REASON_MIN,
  formatAmount,
} from "@/lib/payments/labels";
import { IssuedLinkView } from "@/components/diagnostics/issued-link";

const VOID_FORM_ID = "void-payment-form";

function PaymentLine({ payment }: { payment: Payment }) {
  return (
    <Typography.Paragraph>
      <Typography.Text strong>
        {formatAmount(payment.amount, payment.currency)}
      </Typography.Text>{" "}
      · {PAYMENT_METHOD_LABELS[payment.method]} · ref.{" "}
      <Typography.Text code>{payment.reference}</Typography.Text> ·{" "}
      {payment.lead.name}
    </Typography.Paragraph>
  );
}

interface PaymentModalProps {
  payment: Payment;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Verifica el cobro. Aclara que no crea el diagnóstico: eso es activar. */
export function ConfirmPaymentModal({
  payment,
  onClose,
  onDone,
}: PaymentModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const response = await confirmPaymentAction(payment.id, payment.version);
    setSaving(false);
    if (!response.ok) {
      setError(response.error ?? "No pudimos confirmar el pago.");
      return;
    }
    onDone("Pago confirmado.");
  }

  return (
    <Modal
      title="Confirmar pago"
      open
      onCancel={() => !saving && onClose()}
      onOk={confirm}
      confirmLoading={saving}
      okText="Confirmar pago"
      cancelText="Cancelar"
      destroyOnHidden
    >
      {error && (
        <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />
      )}
      <PaymentLine payment={payment} />
      <Alert
        type="info"
        showIcon
        title="Confirma solo si verificaste el cobro."
        description="Un pago confirmado no se puede editar ni anular. Confirmarlo no crea el diagnóstico: eso se hace después con “Activar diagnóstico”, viendo el total cobrado."
      />
    </Modal>
  );
}

/** Anula un pago pendiente, con motivo. Lo escrito se conserva si falla. */
export function VoidPaymentModal({ payment, onClose, onDone }: PaymentModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit({ reason }: { reason: string }) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const response = await voidPaymentAction(
      payment.id,
      payment.version,
      reason,
    );
    setSaving(false);
    if (!response.ok) {
      setError(response.error ?? "No pudimos anular el pago.");
      return;
    }
    onDone("Pago anulado.");
  }

  return (
    <Modal
      title="Anular pago"
      open
      onCancel={() => !saving && onClose()}
      confirmLoading={saving}
      okButtonProps={{ htmlType: "submit", form: VOID_FORM_ID, danger: true }}
      okText="Anular pago"
      cancelText="Cancelar"
      destroyOnHidden
    >
      {error && (
        <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />
      )}
      <PaymentLine payment={payment} />
      <Form<{ reason: string }>
        id={VOID_FORM_ID}
        layout="vertical"
        onFinish={submit}
        disabled={saving}
        initialValues={{ reason: "" }}
      >
        <Form.Item
          name="reason"
          label="Motivo"
          extra="Queda registrado en el pago. Después puedes registrar otro."
          rules={[
            { required: true, whitespace: true, message: "Indica el motivo." },
            {
              min: VOID_REASON_MIN,
              message: `Debe tener al menos ${VOID_REASON_MIN} caracteres.`,
            },
          ]}
        >
          <Input.TextArea
            autoFocus
            rows={3}
            maxLength={VOID_REASON_MAX}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface ActivateDiagnosticModalProps {
  lead: { id: string; name: string; email: string };
  summary: LeadPaymentSummary;
  onClose: () => void;
}

/**
 * Activa el diagnóstico pagado: muestra el total confirmado, advierte que se
 * le escribe al cliente y, al terminar, el enlace una sola vez.
 */
export function ActivateDiagnosticModal({
  lead,
  summary,
  onClose,
}: ActivateDiagnosticModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ActivationResult | null>(null);
  const [result, setResult] = useState<{
    diagnosticId: string;
    link: IssuedLink;
  } | null>(null);
  const [retrying, setRetrying] = useState(false);

  async function activate() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const response = await activateDiagnosticAction(
      lead.id,
      summary.confirmedCount,
    );
    setSaving(false);
    if (!response.ok || !response.diagnosticId || !response.link) {
      setError(response);
      return;
    }
    setResult({ diagnosticId: response.diagnosticId, link: response.link });
  }

  async function retry() {
    if (!result) return;
    setRetrying(true);
    const response = await resendAccessLinkAction(result.diagnosticId);
    setRetrying(false);
    if (response.ok && response.link) {
      setResult({ ...result, link: response.link });
    } else {
      setError({ ok: false, error: response.error });
    }
  }

  function close() {
    if (saving || retrying) return;
    onClose();
  }

  if (result) {
    return (
      <Modal
        title="Diagnóstico activado"
        open
        onCancel={close}
        mask={{ closable: false }}
        destroyOnHidden
        footer={[
          <Link
            key="open"
            href={`/diagnostics/${encodeURIComponent(result.diagnosticId)}`}
          >
            <Button onClick={onClose}>Ver diagnóstico</Button>
          </Link>,
          <Button key="done" type="primary" onClick={close}>
            Listo
          </Button>,
        ]}
      >
        {error && (
          <Alert
            type="error"
            showIcon
            title={error.error}
            style={{ marginBottom: 16 }}
          />
        )}
        <IssuedLinkView
          link={result.link}
          email={lead.email}
          onRetry={retry}
          retrying={retrying}
        />
      </Modal>
    );
  }

  return (
    <Modal
      title="Activar diagnóstico"
      open
      onCancel={close}
      onOk={activate}
      confirmLoading={saving}
      okText="Activar y enviar enlace"
      cancelText="Cancelar"
      // Tras un 412, `summary` llega recargado: el total que se ve es el nuevo.
      destroyOnHidden
    >
      {error && (
        <Alert
          type={error.stale ? "warning" : "error"}
          showIcon
          title={error.error}
          style={{ marginBottom: 16 }}
        />
      )}
      <Typography.Paragraph>
        <Typography.Text strong>{lead.name}</Typography.Text>{" "}
        <Typography.Text type="secondary">{lead.email}</Typography.Text>
      </Typography.Paragraph>
      <Typography.Paragraph>
        Total confirmado:{" "}
        {summary.confirmedTotals.map((total, index) => (
          <span key={total.currency}>
            {index > 0 && " + "}
            <Typography.Text strong>
              {formatAmount(total.amount, total.currency)}
            </Typography.Text>
          </span>
        ))}
      </Typography.Paragraph>
      <Alert
        type="warning"
        showIcon
        title="Esto crea el diagnóstico y le envía el enlace al cliente."
        description="Actívalo solo si el total cobrado está completo. El lead pasará a convertido."
      />
    </Modal>
  );
}
