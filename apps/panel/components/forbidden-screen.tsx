"use client";

import { useRouter } from "next/navigation";
import { Button, Result } from "antd";

/** Sesión válida, pero la cuenta no tiene permiso para ver esta pantalla. */
export function ForbiddenScreen() {
  const router = useRouter();

  function goBack() {
    // Si se abrió directo en una pestaña nueva, no hay adónde volver.
    if (window.history.length > 1) router.back();
    else router.replace("/");
  }

  return (
    <Result
      status="403"
      title="No tienes acceso a esta sección"
      subTitle="Tu cuenta no tiene permiso para ver esta pantalla. Si crees que deberías tenerlo, pídeselo a un administrador."
      extra={
        <Button type="primary" onClick={goBack}>
          Volver
        </Button>
      }
    />
  );
}
