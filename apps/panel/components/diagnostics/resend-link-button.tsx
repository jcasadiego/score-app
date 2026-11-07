"use client";

import { useState } from "react";
import { Alert, App, Button, Modal } from "antd";
import { resendAccessLinkAction } from "@/app/(panel)/diagnostics/actions";
import type { IssuedLink } from "@/lib/api/diagnostics";
import { IssuedLinkView } from "./issued-link";

interface ResendLinkButtonProps {
  diagnosticId: string;
  email: string;
  disabled?: boolean;
}

/**
 * Pide confirmación, revoca los enlaces vigentes y envía uno nuevo. El enlace
 * nuevo se muestra una sola vez, para copiarlo.
 */
export function ResendLinkButton({
  diagnosticId,
  email,
  disabled,
}: ResendLinkButtonProps) {
  const { modal } = App.useApp();
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<IssuedLink | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (sending) return;
    setSending(true);
    setError(null);
    const result = await resendAccessLinkAction(diagnosticId);
    setSending(false);
    if (result.ok && result.link) {
      setLink(result.link);
    } else {
      setError(result.error ?? "No pudimos reenviar el enlace.");
    }
  }

  function confirm() {
    modal.confirm({
      title: "¿Reenviar el enlace?",
      content:
        "El enlace anterior dejará de funcionar de inmediato y, si el cliente tiene el diagnóstico abierto, tendrá que entrar con el nuevo. Sus respuestas se conservan.",
      okText: "Reenviar",
      cancelText: "Cancelar",
      onOk: resend,
    });
  }

  return (
    <>
      <Button onClick={confirm} loading={sending} disabled={disabled}>
        Reenviar enlace
      </Button>
      {error && !link && (
        <Alert
          type="error"
          showIcon
          title={error}
          closable={{ onClose: () => setError(null) }}
          style={{ marginTop: 12 }}
        />
      )}
      <Modal
        title="Enlace reenviado"
        open={link !== null}
        onCancel={() => !sending && setLink(null)}
        maskClosable={false}
        destroyOnHidden
        footer={
          <Button type="primary" onClick={() => setLink(null)} disabled={sending}>
            Listo
          </Button>
        }
      >
        {error && (
          <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />
        )}
        {link && (
          <IssuedLinkView
            link={link}
            email={email}
            onRetry={resend}
            retrying={sending}
          />
        )}
      </Modal>
    </>
  );
}
