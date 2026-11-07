"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Alert, Button, Form, Input, Modal, Select, Typography } from "antd";
import {
  createDiagnosticAction,
  resendAccessLinkAction,
  searchLeadsAction,
  type IssuedLinkResult,
  type LeadOption,
} from "@/app/(panel)/diagnostics/actions";
import {
  CREATION_REASON_MAX,
  CREATION_REASON_MIN,
} from "@/lib/diagnostics/labels";
import { IssuedLinkView } from "./issued-link";

const FORM_ID = "generate-diagnostic-form";
const SEARCH_DEBOUNCE_MS = 300;

interface FixedLead {
  id: string;
  name: string;
  email: string;
}

interface GenerateDiagnosticModalProps {
  open: boolean;
  /** Lead ya elegido (desde Leads). Sin él, el modal permite buscarlo. */
  lead?: FixedLead;
  onClose: () => void;
}

interface FormValues {
  leadId: string;
  reason: string;
}

function diagnosticHref(id: string) {
  return `/diagnostics/${encodeURIComponent(id)}`;
}

/**
 * Genera el diagnóstico de un lead (solo Aprobador): pide el motivo, porque
 * todavía no hay pagos, y muestra el enlace una sola vez. Quien lo monta debe
 * darle un `key` nuevo en cada apertura, para que el formulario empiece vacío.
 */
export function GenerateDiagnosticModal({
  open,
  lead,
  onClose,
}: GenerateDiagnosticModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<IssuedLinkResult | null>(null);
  const [result, setResult] = useState<{
    diagnosticId: string;
    email: string;
    link: NonNullable<IssuedLinkResult["link"]>;
  } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [options, setOptions] = useState<LeadOption[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  function search(query: string) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      const found = await searchLeadsAction(query);
      setSearching(false);
      setOptions(found.leads);
    }, SEARCH_DEBOUNCE_MS);
  }

  async function submit(values: FormValues) {
    // El botón ya queda deshabilitado; esto frena un segundo envío en el mismo tick.
    if (saving) return;
    setSaving(true);
    setError(null);
    const leadId = lead?.id ?? values.leadId;
    const response = await createDiagnosticAction(leadId, values.reason);
    setSaving(false);

    if (!response.ok || !response.link || !response.diagnosticId) {
      setError(response);
      return;
    }
    const email =
      lead?.email ?? options.find((o) => o.id === leadId)?.email ?? "";
    setResult({
      diagnosticId: response.diagnosticId,
      email,
      link: response.link,
    });
  }

  async function retry() {
    if (!result) return;
    setRetrying(true);
    const response = await resendAccessLinkAction(result.diagnosticId);
    setRetrying(false);
    if (response.ok && response.link) {
      setResult({ ...result, link: response.link });
    } else {
      setError(response);
    }
  }

  function close() {
    if (saving || retrying) return;
    onClose();
  }

  if (result) {
    return (
      <Modal
        title="Diagnóstico generado"
        open={open}
        onCancel={close}
        maskClosable={false}
        destroyOnHidden
        footer={[
          <Link key="open" href={diagnosticHref(result.diagnosticId)}>
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
          email={result.email}
          onRetry={retry}
          retrying={retrying}
        />
      </Modal>
    );
  }

  return (
    <Modal
      title="Generar diagnóstico"
      open={open}
      onCancel={close}
      confirmLoading={saving}
      okButtonProps={{ htmlType: "submit", form: FORM_ID }}
      okText="Generar y enviar"
      cancelText="Cancelar"
      destroyOnHidden
    >
      {error && (
        <Alert
          type="error"
          showIcon
          title={error.error}
          action={
            error.existingDiagnosticId && (
              <Link href={diagnosticHref(error.existingDiagnosticId)}>
                <Button size="small" onClick={onClose}>
                  Abrir diagnóstico
                </Button>
              </Link>
            )
          }
          style={{ marginBottom: 16 }}
        />
      )}
      <Form<FormValues>
        id={FORM_ID}
        layout="vertical"
        onFinish={submit}
        disabled={saving}
        initialValues={{ reason: "" }}
      >
        {lead ? (
          <Form.Item label="Lead">
            <Typography.Text strong>{lead.name}</Typography.Text>{" "}
            <Typography.Text type="secondary">{lead.email}</Typography.Text>
          </Form.Item>
        ) : (
          <Form.Item
            name="leadId"
            label="Lead"
            rules={[{ required: true, message: "Elige un lead." }]}
          >
            <Select
              showSearch={{ filterOption: false, onSearch: search }}
              placeholder="Busca por nombre o correo"
              loading={searching}
              onOpenChange={(visible) => {
                if (visible && options.length === 0) search("");
              }}
              notFoundContent={searching ? "Buscando…" : "Sin resultados"}
              options={options.map((option) => ({
                value: option.id,
                disabled: option.diagnosticId !== null,
                label: `${option.name} · ${option.email}${
                  option.diagnosticId ? " (ya tiene diagnóstico)" : ""
                }`,
              }))}
            />
          </Form.Item>
        )}

        <Form.Item
          name="reason"
          label="Motivo"
          extra="Por qué se genera sin pago. Queda registrado en el diagnóstico."
          rules={[
            {
              required: true,
              whitespace: true,
              message: "Indica el motivo.",
            },
            {
              min: CREATION_REASON_MIN,
              message: `Debe tener al menos ${CREATION_REASON_MIN} caracteres.`,
            },
          ]}
        >
          <Input.TextArea
            autoFocus={Boolean(lead)}
            rows={3}
            maxLength={CREATION_REASON_MAX}
            showCount
          />
        </Form.Item>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Le enviaremos al lead un enlace por correo para responder el
          cuestionario, sin crear contraseña. El enlace también se mostrará aquí
          una sola vez para que puedas copiarlo.
        </Typography.Paragraph>
      </Form>
    </Modal>
  );
}
