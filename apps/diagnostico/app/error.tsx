"use client";

import { useEffect, useRef } from "react";
import { Card, buttonClass } from "@/components/ui";

/**
 * Error no previsto en una página o al guardar. El caso más común: la página
 * quedó abierta durante una actualización y recargar lo resuelve. Sin esto,
 * Next mostraba su pantalla por defecto en inglés (PF-73).
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // El foco al título, para que el lector de pantalla anuncie el cambio.
    heading.current?.focus();
    // Solo el digest: el mensaje puede traer datos de la persona.
    const digest =
      error && typeof error === "object" && "digest" in error
        ? String(error.digest)
        : "sin digest";
    console.error(`Error no previsto en el diagnóstico (${digest})`);
  }, [error]);

  return (
    <main className="flex flex-col gap-6">
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-2xl font-semibold outline-none sm:text-3xl"
      >
        No pudimos cargar esta página
      </h1>
      <Card>
        <p className="text-base leading-relaxed">
          Recarga la página para seguir. Las respuestas que ya guardaste no se
          pierden. Si sigue fallando, intenta en unos minutos.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className={buttonClass.primary}
            onClick={() => window.location.reload()}
          >
            Recargar la página
          </button>
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={() => retry()}
          >
            Reintentar
          </button>
        </div>
      </Card>
    </main>
  );
}
