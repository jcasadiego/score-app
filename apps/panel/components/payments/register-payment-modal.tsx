"use client";

import { useState } from "react";
import { Alert, Form, Input, Modal, Select, Typography } from "antd";
import { registerPaymentAction } from "@/app/(panel)/payments/actions";
import {
  AMOUNT_PATTERN,
  CURRENCIES,
  CURRENCY_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  REFERENCE_MAX,
  normalizeAmount,
  type CurrencyCode,
  type PaymentMethod,
} from "@/lib/payments/labels";

const FORM_ID = "register-payment-form";

interface RegisterPaymentModalProps {
  lead: { id: string; name: string; email: string };
  onClose: () => void;
  onRegistered: () => void;
}

interface FormValues {
  amount: string;
  currency: CurrencyCode;
  method: PaymentMethod;
  reference: string;
  /** `YYYY-MM-DD` del selector nativo, en la zona del navegador. */
  paidOn: string;
}

/** Hoy, como `YYYY-MM-DD` local: tope del selector de fecha. */
function today(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Registra un pago pendiente (solo Aprobador). Quien lo monta le da un `key`
 * nuevo en cada apertura, para que el formulario empiece vacío.
 */
export function RegisterPaymentModal({
  lead,
  onClose,
  onRegistered,
}: RegisterPaymentModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxDate = today();

  async function submit(values: FormValues) {
    if (saving) return;
    setSaving(true);
    setError(null);
    // Medianoche local del día elegido: nunca queda en el futuro.
    const [year, month, day] = values.paidOn.split("-").map(Number);
    const response = await registerPaymentAction({
      leadId: lead.id,
      amount: normalizeAmount(values.amount),
      currency: values.currency,
      method: values.method,
      reference: values.reference,
      paidAt: new Date(year, month - 1, day).toISOString(),
    });
    setSaving(false);
    if (!response.ok) {
      // Se queda abierto, con lo escrito, para corregir y reintentar.
      setError(response.error ?? "No pudimos registrar el pago.");
      return;
    }
    onRegistered();
  }

  return (
    <Modal
      title="Registrar pago"
      open
      onCancel={() => !saving && onClose()}
      confirmLoading={saving}
      okButtonProps={{ htmlType: "submit", form: FORM_ID }}
      okText="Registrar"
      cancelText="Cancelar"
      destroyOnHidden
    >
      {error && (
        <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />
      )}
      <Form<FormValues>
        id={FORM_ID}
        layout="vertical"
        onFinish={submit}
        disabled={saving}
        initialValues={{ currency: "USD", paidOn: maxDate }}
      >
        <Form.Item label="Lead">
          <Typography.Text strong>{lead.name}</Typography.Text>{" "}
          <Typography.Text type="secondary">{lead.email}</Typography.Text>
        </Form.Item>
        <Form.Item
          name="amount"
          label="Monto"
          extra="Con punto o coma para los decimales (máximo 2)."
          rules={[
            { required: true, message: "Indica el monto." },
            {
              validator: (_, value?: string) =>
                !value || AMOUNT_PATTERN.test(normalizeAmount(value))
                  ? Promise.resolve()
                  : Promise.reject(
                      new Error("Debe ser mayor que cero, con hasta 2 decimales."),
                    ),
            },
          ]}
        >
          <Input inputMode="decimal" autoFocus placeholder="150.00" />
        </Form.Item>
        <Form.Item
          name="currency"
          label="Moneda"
          rules={[{ required: true, message: "Elige la moneda." }]}
        >
          <Select
            options={CURRENCIES.map((c) => ({
              value: c,
              label: CURRENCY_LABELS[c],
            }))}
          />
        </Form.Item>
        <Form.Item
          name="method"
          label="Método"
          rules={[{ required: true, message: "Elige el método." }]}
        >
          <Select
            placeholder="Elige el método"
            options={PAYMENT_METHODS.map((m) => ({
              value: m,
              label: PAYMENT_METHOD_LABELS[m],
            }))}
          />
        </Form.Item>
        <Form.Item
          name="reference"
          label="Referencia"
          extra="Número de transferencia, id de PayPal o similar."
          rules={[
            { required: true, whitespace: true, message: "Indica la referencia." },
          ]}
        >
          <Input maxLength={REFERENCE_MAX} />
        </Form.Item>
        <Form.Item
          name="paidOn"
          label="Fecha del pago"
          rules={[
            { required: true, message: "Indica la fecha." },
            {
              validator: (_, value?: string) =>
                !value || value <= maxDate
                  ? Promise.resolve()
                  : Promise.reject(new Error("No puede ser una fecha futura.")),
            },
          ]}
        >
          <Input type="date" max={maxDate} />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Queda pendiente hasta que lo confirmes. Registrarlo no crea el
          diagnóstico ni le escribe al cliente.
        </Typography.Paragraph>
      </Form>
    </Modal>
  );
}
