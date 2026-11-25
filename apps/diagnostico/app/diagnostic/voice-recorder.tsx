"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, buttonClass } from "@/components/ui";
import type { ActionResult, SavedRecording } from "@/lib/api/types";
import { ROUTES } from "@/lib/routes";
import { deleteRecording, getRecordingUrl, giveVoiceConsent } from "./actions";
import {
  formatDuration,
  MAX_RECORDING_MS,
  VOICE_CONSENT_PARAGRAPHS,
  VOICE_CONSENT_TITLE,
  VOICE_CONSENT_VERSION,
} from "./voice-consent";

type Phase =
  | { name: "idle" }
  | { name: "consent" }
  | { name: "starting" }
  | { name: "recording"; startedAt: number }
  | { name: "uploading" }
  | { name: "failed"; message: string }
  | { name: "deleting" };

/** Lo que grabó el navegador y todavía no se guardó, o ya se guardó. */
interface LocalTake {
  blob: Blob;
  durationMs: number;
  url: string;
}

const UPLOAD_ERRORS: Record<number, string> = {
  413: "El audio no se pudo guardar: intenta una grabación más corta.",
  415: "El audio no se pudo guardar: intenta una grabación más corta.",
  503: "No pudimos guardar el audio ahora. Puedes responder por escrito o intentar de nuevo.",
};
const NETWORK_ERROR =
  "No pudimos guardar el audio por un problema de conexión. Tu grabación sigue aquí: intenta de nuevo.";
const MIC_DENIED =
  "No diste permiso para usar el micrófono. Puedes permitirlo en la configuración del navegador o responder por escrito.";
const MIC_UNAVAILABLE =
  "Este navegador no puede grabar audio. Puedes responder por escrito.";

/** El formato que el navegador sabe grabar: WebM/Opus (Chrome) o MP4 (Safari). */
function pickMimeType(): string | undefined {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

/**
 * Responder por voz una pregunta (PF-87): grabar, detener, escuchar, volver a
 * grabar y borrar. La voz nunca es obligatoria. El audio solo vive en memoria
 * mientras se sube; nunca se guarda en el navegador. El estado se anuncia en
 * una región `aria-live` y no depende solo del color.
 */
export function VoiceRecorder({
  questionId,
  recording,
  consentGiven,
  onConsent,
  onSaved,
  onDeleted,
}: {
  questionId: string;
  recording: SavedRecording | null;
  consentGiven: boolean;
  onConsent: () => void;
  onSaved: (recording: SavedRecording) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [take, setTake] = useState<LocalTake | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const takeUrlRef = useRef<string | null>(null);
  const consentHeadingRef = useRef<HTMLHeadingElement>(null);
  // El foco no puede quedar en un botón que desaparece (WCAG 2.4.3).
  const sectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const focusSection = () =>
    requestAnimationFrame(() => sectionHeadingRef.current?.focus());
  const unmountedRef = useRef(false);

  // Al salir de la pregunta: detiene la grabación (se guarda igual, ver
  // `onstop`), suelta el micrófono y la memoria del audio.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase.name === "consent") consentHeadingRef.current?.focus();
  }, [phase.name]);

  function replaceTake(next: LocalTake | null) {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = next?.url ?? null;
    setTake(next);
  }

  function handleFatal(result: ActionResult<unknown>): boolean {
    if (result.ok) return false;
    if (result.status === 401) {
      router.replace(ROUTES.sessionEnded);
      return true;
    }
    if (result.code === "DIAGNOSTIC_COMPLETED") {
      router.refresh();
      return true;
    }
    return false;
  }

  function requestRecording() {
    setError(null);
    if (!consentGiven) {
      setPhase({ name: "consent" });
      return;
    }
    void startRecording();
  }

  async function acceptConsent() {
    setPhase({ name: "starting" });
    const result = await giveVoiceConsent(VOICE_CONSENT_VERSION);
    if (handleFatal(result)) return;
    if (!result.ok) {
      setPhase({ name: "consent" });
      setError(result.message);
      focusSection();
      return;
    }
    onConsent();
    await startRecording();
  }

  async function startRecording() {
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setPhase({ name: "idle" });
      setError(MIC_UNAVAILABLE);
      return;
    }
    setPhase({ name: "starting" });
    let stream: MediaStream;
    try {
      // El permiso se pide recién aquí, al tocar "Grabar".
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      setPhase({ name: "idle" });
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? MIC_DENIED
          : MIC_UNAVAILABLE,
      );
      return;
    }
    streamRef.current = stream;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const durationMs = Math.min(Date.now() - startedAt, MAX_RECORDING_MS);
      const blob = new Blob(chunks, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });
      // Si el cliente pasó a otra pregunta mientras grababa, igual se guarda:
      // la respuesta no se pierde, y la pregunta la mostrará al volver.
      if (unmountedRef.current) {
        void upload({ blob, durationMs, url: "" });
        return;
      }
      const next = { blob, durationMs, url: URL.createObjectURL(blob) };
      replaceTake(next);
      void upload(next);
    };
    recorderRef.current = recorder;
    recorder.start();
    setElapsedMs(0);
    setPhase({ name: "recording", startedAt });
    setNotice("Grabando. Toca Detener cuando termines.");
    requestAnimationFrame(() => stopButtonRef.current?.focus());
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_RECORDING_MS) {
        setNotice(
          `Llegaste al máximo de ${formatDuration(MAX_RECORDING_MS)} minutos: la grabación se detuvo.`,
        );
        stopRecording();
      }
    }, 250);
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    focusSection();
  }

  async function upload(current: LocalTake) {
    setPhase({ name: "uploading" });
    setNotice("Guardando tu grabación…");
    const form = new FormData();
    form.set("audio", current.blob, "respuesta");
    form.set("durationMs", String(current.durationMs));
    let result: ActionResult<SavedRecording>;
    try {
      const response = await fetch(
        `/diagnostic/recording/${encodeURIComponent(questionId)}`,
        { method: "PUT", body: form },
      );
      result = (await response.json()) as ActionResult<SavedRecording>;
    } catch {
      setPhase({ name: "failed", message: NETWORK_ERROR });
      setNotice("");
      return;
    }
    if (handleFatal(result)) return;
    if (!result.ok) {
      if (result.code === "VOICE_CONSENT_REQUIRED") {
        replaceTake(null);
        setPhase({ name: "consent" });
        return;
      }
      setPhase({
        name: "failed",
        message: UPLOAD_ERRORS[result.status] ?? result.message,
      });
      setNotice("");
      return;
    }
    setRemoteUrl(null);
    onSaved(result.data);
    setPhase({ name: "idle" });
    setNotice(`Grabación guardada (${formatDuration(current.durationMs)}).`);
  }

  async function remove() {
    setError(null);
    setPhase({ name: "deleting" });
    const result = await deleteRecording(questionId);
    if (handleFatal(result)) return;
    if (!result.ok) {
      setPhase({ name: "idle" });
      setError(result.message);
      return;
    }
    replaceTake(null);
    setRemoteUrl(null);
    onDeleted();
    setPhase({ name: "idle" });
    setNotice("Grabación borrada.");
    focusSection();
  }

  async function loadSaved() {
    setError(null);
    const result = await getRecordingUrl(questionId);
    if (handleFatal(result)) return;
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRemoteUrl(result.data.url);
  }

  const busy =
    phase.name === "starting" ||
    phase.name === "uploading" ||
    phase.name === "deleting";
  const playbackUrl = take?.url ?? remoteUrl;
  const hasSaved = recording !== null;
  // Un diagnóstico retomado tras 90 días sin actividad (PF-90).
  const audioDeleted = !!recording?.audioDeletedAt && !take;

  return (
    <section
      aria-labelledby={`${questionId}-voice-title`}
      className="mt-5 rounded-lg border border-line bg-canvas p-4"
    >
      <h2
        ref={sectionHeadingRef}
        tabIndex={-1}
        id={`${questionId}-voice-title`}
        className="text-base font-semibold"
      >
        O responde con tu voz{" "}
        <span className="font-normal text-ink-muted">(opcional)</span>
      </h2>

      {phase.name === "consent" && (
        <div className="mt-3 flex flex-col gap-3">
          <h3
            ref={consentHeadingRef}
            tabIndex={-1}
            className="text-base font-semibold"
          >
            {VOICE_CONSENT_TITLE}
          </h3>
          {VOICE_CONSENT_PARAGRAPHS.map((paragraph) => (
            <p key={paragraph} className="text-sm leading-relaxed">
              {paragraph}
            </p>
          ))}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void acceptConsent()}
              className={buttonClass.primary}
            >
              Acepto y quiero grabar
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase({ name: "idle" });
                focusSection();
              }}
              className={buttonClass.secondary}
            >
              Prefiero escribir
            </button>
          </div>
        </div>
      )}

      {phase.name === "recording" && (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <p className="flex items-center gap-2 font-medium text-danger">
            <span aria-hidden="true">●</span>
            Grabando{" "}
            <span className="tabular-nums">
              {formatDuration(elapsedMs)} / {formatDuration(MAX_RECORDING_MS)}
            </span>
          </p>
          <button
            ref={stopButtonRef}
            type="button"
            onClick={stopRecording}
            className={buttonClass.primary}
          >
            Detener
          </button>
        </div>
      )}

      {phase.name !== "consent" && phase.name !== "recording" && (
        <div className="mt-3 flex flex-col gap-3">
          {(busy || hasSaved || take) && (
            <p className="text-sm">
              {phase.name === "uploading"
                ? "Guardando tu grabación…"
                : phase.name === "deleting"
                  ? "Borrando la grabación…"
                  : audioDeleted
                    ? "El audio de tu respuesta se borró por plazo. Si quieres, puedes volver a grabarla."
                    : hasSaved
                      ? `Grabación guardada (${formatDuration(recording.durationMs)}).`
                      : take
                        ? "Grabación sin guardar."
                        : null}
            </p>
          )}
          {playbackUrl ? (
            <audio
              controls
              src={playbackUrl}
              preload="metadata"
              aria-label="Escuchar tu grabación"
              className="w-full"
            />
          ) : (
            hasSaved &&
            !audioDeleted && (
              <button
                type="button"
                onClick={() => void loadSaved()}
                disabled={busy}
                className={`${buttonClass.secondary} self-start`}
              >
                Escuchar grabación
              </button>
            )
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            {phase.name === "failed" && take && (
              <button
                type="button"
                onClick={() => void upload(take)}
                className={buttonClass.primary}
              >
                Reintentar guardar
              </button>
            )}
            <button
              type="button"
              onClick={requestRecording}
              disabled={busy}
              className={
                hasSaved || take ? buttonClass.secondary : buttonClass.primary
              }
            >
              {hasSaved || take ? "Volver a grabar" : "Grabar respuesta"}
            </button>
            {hasSaved && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className={buttonClass.secondary}
              >
                Borrar grabación
              </button>
            )}
          </div>
        </div>
      )}

      {/* Solo para el lector de pantalla: lo visible ya está arriba. */}
      <p aria-live="polite" className="sr-only">
        {phase.name === "uploading"
          ? "Guardando tu grabación…"
          : phase.name === "deleting"
            ? "Borrando la grabación…"
            : notice}
      </p>
      {(phase.name === "failed" || error) && (
        <div className="mt-2">
          <Alert tone="danger" announce>
            {phase.name === "failed" ? phase.message : error}
          </Alert>
        </div>
      )}
    </section>
  );
}
