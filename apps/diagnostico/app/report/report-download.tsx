"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Alert, Card, buttonClass } from "@/components/ui";
import { downloadReport } from "./actions";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

const readToken = () =>
  new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";

/** El nombre con que se guarda el archivo: sin datos del cliente. */
const FILENAME = "informe-score.pdf";

/** Guarda el PDF en el dispositivo sin salir de la página. */
function saveFile(bytes: Uint8Array) {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: "application/pdf" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = FILENAME;
  document.body.append(link);
  link.click();
  link.remove();
  // Algunos navegadores leen el archivo después del clic.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type Outcome =
  | { kind: "idle" }
  | { kind: "downloaded" }
  | { kind: "invalid" }
  | { kind: "error"; message: string };

/**
 * Descarga del informe. El token va en el fragmento (`#token=…`): nunca llega
 * al servidor de esta app ni a sus logs. Se usa al pulsar el botón, no al abrir
 * la página, para que un antivirus o la vista previa del correo no gasten una
 * descarga.
 */
export function ReportDownload() {
  // En el servidor no hay fragmento: `null` mientras se hidrata.
  const token = useSyncExternalStore(subscribe, readToken, () => null);
  // El resultado es del token con que se pidió: si el fragmento cambia (otro
  // enlace abierto en la misma pestaña), la página vuelve a empezar.
  const [result, setResult] = useState<{ token: string; outcome: Outcome }>();
  const outcome: Outcome =
    result && result.token === token ? result.outcome : { kind: "idle" };
  const setOutcome = (next: Outcome) =>
    setResult({ token: token ?? "", outcome: next });
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);

  function download() {
    if (!token) return;
    startTransition(async () => {
      const result = await downloadReport(token);
      if (result.ok) {
        saveFile(result.data);
        setOutcome({ kind: "downloaded" });
      } else if (result.status === 401) {
        setOutcome({ kind: "invalid" });
        // El título cambia: el foco va a él para que se lea primero.
        requestAnimationFrame(() => headingRef.current?.focus());
      } else {
        setOutcome({
          kind: "error",
          message:
            result.status === 429
              ? result.message
              : "No pudimos preparar tu informe. Intenta de nuevo en un momento.",
        });
      }
    });
  }

  if (token === "" || outcome.kind === "invalid") {
    const incomplete = token === "";
    return (
      <main className="flex flex-col gap-6">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold sm:text-3xl"
        >
          {incomplete
            ? "El enlace está incompleto"
            : "Este enlace ya no sirve"}
        </h1>
        <Card>
          <p className="text-base leading-relaxed">
            {incomplete
              ? "Abre el enlace directamente desde el correo que te enviamos. Si lo copiaste a mano, puede haberle faltado una parte."
              : "Puede que haya vencido o que te hayamos enviado uno más reciente. Busca en tu correo el mensaje más nuevo con tu informe."}
          </p>
          <p className="mt-4 text-base leading-relaxed">
            Si no lo encuentras, responde al correo en el que te llegó el
            informe y el equipo de Music Finance Pro te enviará un enlace
            nuevo.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">
        Tu informe SCORE está listo
      </h1>
      <Card>
        <p className="text-base leading-relaxed">
          Gracias por completar tu diagnóstico. El equipo de Music Finance Pro
          revisó tus resultados y preparó tu informe.
        </p>
        <p className="mt-4 text-base leading-relaxed text-ink-muted">
          Se descarga como PDF en este dispositivo. Es personal: no compartas
          este enlace.
        </p>
        <div className="mt-5 flex flex-col gap-3" aria-live="polite">
          {outcome.kind === "downloaded" && (
            <Alert tone="success" title="Listo, tu informe se descargó">
              Búscalo en las descargas de tu dispositivo como{" "}
              <span className="font-medium">{FILENAME}</span>. Puedes volver a
              descargarlo con este mismo enlace mientras siga vigente.
            </Alert>
          )}
        </div>
        {outcome.kind === "error" && (
          <div className="mt-3">
            <Alert tone="danger" announce>
              {outcome.message}
            </Alert>
          </div>
        )}
        <button
          type="button"
          onClick={download}
          disabled={!token || pending}
          className={`${buttonClass.primary} mt-6 w-full sm:w-auto`}
        >
          {pending
            ? "Preparando tu informe…"
            : outcome.kind === "idle"
              ? "Descargar mi informe (PDF)"
              : outcome.kind === "error"
                ? "Intentar de nuevo"
                : "Descargar de nuevo"}
        </button>
      </Card>
    </main>
  );
}
