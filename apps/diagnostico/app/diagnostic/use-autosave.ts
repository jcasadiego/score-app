"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ActionResult } from "@/lib/api/types";
import { ALREADY_SUBMITTED_URL, ROUTES } from "@/lib/routes";

export type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "retrying"; message: string }
  | { state: "error"; message: string; retryable: boolean };

/** Esperas entre reintentos de un guardado que falló por red o servidor. */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

interface AutosaveHandlers<V> {
  fingerprint: (value: V) => string;
  persist: (key: string, value: V) => Promise<ActionResult>;
  onStatus: (key: string, status: SaveStatus) => void;
  /** La sesión terminó (401) o el diagnóstico ya se envió: hay que salir. */
  onFatal: (status: number) => void;
}

/**
 * Guardado automático por clave (pregunta o plataforma). Los guardados de una
 * misma clave van en fila, y cada uno envía el último valor: lo escrito nunca se
 * pierde aunque la red falle. Un fallo de red o del servidor se reintenta solo;
 * uno de validación queda a la vista hasta que el cliente corrija.
 */
class AutosaveQueue<V> {
  private readonly latest: Record<string, V>;
  private readonly saved: Record<string, string>;
  private readonly queues: Record<string, Promise<boolean>> = {};
  private readonly timers: Record<string, ReturnType<typeof setTimeout>> = {};
  private readonly attempts: Record<string, number> = {};

  constructor(
    initial: Record<string, V>,
    private handlers: AutosaveHandlers<V>,
  ) {
    this.latest = { ...initial };
    this.saved = Object.fromEntries(
      Object.entries(initial).map(([k, v]) => [k, handlers.fingerprint(v)]),
    );
  }

  isDirty(key: string): boolean {
    return (
      key in this.latest &&
      this.handlers.fingerprint(this.latest[key]) !== this.saved[key]
    );
  }

  hasPending = (): boolean => Object.keys(this.latest).some((k) => this.isDirty(k));

  /** Registra un valor nuevo y lo guarda tras `delayMs` sin cambios. */
  update(key: string, value: V, delayMs = 0): void {
    this.latest[key] = value;
    this.attempts[key] = 0;
    clearTimeout(this.timers[key]);
    if (!this.isDirty(key)) {
      this.handlers.onStatus(key, { state: "idle" });
      return;
    }
    this.timers[key] = setTimeout(() => void this.flush(key), delayMs);
  }

  /** Guarda ya lo pendiente de una clave. */
  flush(key: string): Promise<boolean> {
    clearTimeout(this.timers[key]);
    const next = (this.queues[key] ?? Promise.resolve(true)).then(() =>
      this.run(key),
    );
    this.queues[key] = next;
    return next;
  }

  /** Guarda ya todo lo pendiente; `true` si quedó todo guardado. */
  async flushAll(): Promise<boolean> {
    const keys = Object.keys(this.latest);
    const results = await Promise.all(
      keys.map((key) =>
        this.isDirty(key) ? this.flush(key) : (this.queues[key] ?? true),
      ),
    );
    return results.every(Boolean) && !this.hasPending();
  }

  setHandlers(handlers: AutosaveHandlers<V>): void {
    this.handlers = handlers;
  }

  dispose(): void {
    Object.values(this.timers).forEach(clearTimeout);
  }

  private async run(key: string): Promise<boolean> {
    if (!this.isDirty(key)) return true;
    const { fingerprint, persist, onStatus, onFatal } = this.handlers;
    const value = this.latest[key];
    onStatus(key, { state: "saving" });

    const result = await persist(key, value);
    if (result.ok) {
      this.saved[key] = fingerprint(value);
      this.attempts[key] = 0;
      // Si cambió mientras se guardaba, el siguiente de la fila lo envía.
      onStatus(key, this.isDirty(key) ? { state: "saving" } : { state: "saved" });
      return true;
    }

    if (result.status === 401 || result.code === "DIAGNOSTIC_COMPLETED") {
      onFatal(result.status);
      return false;
    }
    const transient =
      result.status === 0 || result.status === 429 || result.status >= 500;
    if (!transient) {
      onStatus(key, {
        state: "error",
        message: result.errors?.[0]?.message ?? result.message,
        retryable: false,
      });
      return false;
    }

    const attempt = this.attempts[key] ?? 0;
    if (attempt < RETRY_DELAYS_MS.length) {
      this.attempts[key] = attempt + 1;
      onStatus(key, {
        state: "retrying",
        message: "No se pudo guardar. Lo intentamos de nuevo en unos segundos.",
      });
      clearTimeout(this.timers[key]);
      this.timers[key] = setTimeout(
        () => void this.flush(key),
        RETRY_DELAYS_MS[attempt],
      );
    } else {
      onStatus(key, {
        state: "error",
        message:
          "No se pudo guardar. Revisa tu conexión; lo que escribiste sigue aquí.",
        retryable: true,
      });
    }
    return false;
  }
}

export function useAutosave<V>({
  initial,
  fingerprint,
  persist,
}: {
  /** Lo que ya está guardado en la API, por clave. */
  initial: Record<string, V>;
  /** Clave estable para comparar valores (sin espacios sobrantes, etc.). */
  fingerprint: (value: V) => string;
  /** Guarda (o borra, si el valor está vacío) un valor en la API. */
  persist: (key: string, value: V) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});
  const [queue] = useState(
    () =>
      new AutosaveQueue<V>(initial, {
        fingerprint,
        persist,
        onStatus: () => {},
        onFatal: () => {},
      }),
  );

  // Cada render deja en la fila las funciones vigentes.
  useEffect(() => {
    queue.setHandlers({
      fingerprint,
      persist,
      onStatus: (key, next) =>
        setStatus((current) => ({ ...current, [key]: next })),
      onFatal: (status) =>
        router.replace(
          status === 401 ? ROUTES.sessionEnded : ALREADY_SUBMITTED_URL,
        ),
    });
  });
  useEffect(() => () => queue.dispose(), [queue]);

  return { status, queue };
}
