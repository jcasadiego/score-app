"use client";

import { Alert, Button, Flex, Typography } from "antd";
import type { IssuedLink } from "@/lib/api/diagnostics";
import { LocalDate } from "@/components/local-date";

interface IssuedLinkViewProps {
  link: IssuedLink;
  /** A quién se le envió el correo. */
  email: string;
  /** Reenvía el enlace si el correo falló. */
  onRetry: () => void;
  retrying: boolean;
}

/**
 * El enlace que la API devuelve una sola vez. Vive solo en el estado del
 * modal: al cerrarlo se pierde, y para tener otro hay que reenviarlo.
 */
export function IssuedLinkView({
  link,
  email,
  onRetry,
  retrying,
}: IssuedLinkViewProps) {
  return (
    <Flex vertical gap={16}>
      {link.emailSent ? (
        <Alert
          type="success"
          showIcon
          title={`Le enviamos el enlace por correo a ${email}.`}
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          title="No pudimos enviar el correo."
          description="Copia el enlace y házselo llegar al cliente, o reintenta el envío."
          action={
            <Button size="small" onClick={onRetry} loading={retrying}>
              Reintentar envío
            </Button>
          }
        />
      )}

      <div>
        <Typography.Text
          type="secondary"
          style={{ display: "block", marginBottom: 4 }}
        >
          Enlace del cliente (vence el{" "}
          <LocalDate iso={link.accessLink.expiresAt} />)
        </Typography.Text>
        <Typography.Paragraph
          copyable={{ text: link.accessLink.url, tooltips: ["Copiar", "Copiado"] }}
          code
          style={{ overflowWrap: "anywhere", marginBottom: 0 }}
        >
          {link.accessLink.url}
        </Typography.Paragraph>
      </div>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Este enlace es personal y solo se muestra ahora: al cerrar esta ventana
        no se podrá volver a ver. Si hace falta otro, usa &quot;Reenviar
        enlace&quot;; el anterior dejará de funcionar.
        {!link.emailSent &&
          " Reintentar el envío también genera un enlace nuevo."}
      </Typography.Paragraph>
    </Flex>
  );
}
