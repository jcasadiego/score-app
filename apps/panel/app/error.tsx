"use client";

import { useEffect } from "react";
import { Button, Result, Space } from "antd";

/**
 * Error no previsto en una página o en una Server Action. El caso más común en
 * QA: la página quedó abierta durante un despliegue y su acción ya no existe en
 * la versión nueva; recargar lo resuelve. Sin esto, Next mostraba su pantalla
 * por defecto en inglés (PF-73).
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    // Solo el digest: el mensaje puede traer datos de la persona.
    const digest =
      error && typeof error === "object" && "digest" in error
        ? String(error.digest)
        : "sin digest";
    console.error(`Error no previsto en el panel (${digest})`);
  }, [error]);

  return (
    <Result
      status="warning"
      title="No pudimos cargar esta página"
      subTitle="Puede pasar justo después de una actualización del panel. Recarga la página; si sigue fallando, intenta en unos minutos."
      extra={
        <Space>
          <Button type="primary" onClick={() => window.location.reload()}>
            Recargar la página
          </Button>
          <Button onClick={() => retry()}>Reintentar</Button>
        </Space>
      }
    />
  );
}
