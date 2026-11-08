import { Alert } from "@/components/ui";
import type { SaveStatus } from "./use-autosave";

/**
 * Estado del guardado de un campo. "Guardando/Guardado" se anuncia con
 * discreción (`aria-live="polite"`); un error, de inmediato.
 */
export function SaveStatusLine({
  id,
  status,
  onRetry,
}: {
  id: string;
  status?: SaveStatus;
  onRetry?: () => void;
}) {
  const state = status?.state ?? "idle";
  if (state === "retrying" || state === "error") {
    const { message } = status as { message: string };
    const retryable = state === "error" && (status as { retryable: boolean }).retryable;
    return (
      <div id={id}>
        <Alert tone="danger" announce>
          {message}
          {retryable && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-2 min-h-6 font-semibold underline underline-offset-4"
            >
              Reintentar
            </button>
          )}
        </Alert>
      </div>
    );
  }
  return (
    <p id={id} aria-live="polite" className="min-h-5 text-sm text-ink-muted">
      {state === "saving" ? "Guardando…" : state === "saved" ? "Guardado ✓" : ""}
    </p>
  );
}
