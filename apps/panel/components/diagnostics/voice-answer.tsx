"use client";

import { useRef, useState, useTransition } from "react";
import { Alert, App, Button, Flex, Tag, Typography } from "antd";
import type {
  AnswerRecording,
  TranscriptionStatus,
} from "@/lib/api/diagnostics";
import {
  recordingPlaybackAction,
  retryTranscriptionAction,
} from "@/app/(panel)/diagnostics/actions";
import { LocalDate } from "@/components/local-date";

const STATUS: Record<TranscriptionStatus, { label: string; color: string }> = {
  PENDING: { label: "Transcripción pendiente", color: "gold" },
  COMPLETED: { label: "Transcripción automática", color: "geekblue" },
  FAILED: { label: "Transcripción fallida", color: "red" },
};

/** 1:05 para 65 s. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * La respuesta por voz de una pregunta (PF-89): reproductor, duración y la
 * transcripción con su estado. La URL del audio se pide al pulsar "Escuchar"
 * (cada pedido queda en la bitácora) y nunca va en el HTML inicial; si vence,
 * se pide otra. Sin descarga: el reproductor no la ofrece.
 */
export function VoiceAnswer({
  diagnosticId,
  questionId,
  recording,
}: {
  diagnosticId: string;
  questionId: string;
  recording: AnswerRecording;
}) {
  const { message } = App.useApp();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<{ url: string; expiresAt: number } | null>(
    null,
  );
  const [loading, startLoading] = useTransition();
  const [retrying, startRetrying] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const transcription = recording.transcription;
  const audioDeleted = recording.audioDeletedAt !== null;
  // Sin audio no se puede volver a transcribir.
  const canRetry = transcription?.status === "FAILED" && !audioDeleted;

  function listen() {
    setError(null);
    startLoading(async () => {
      const result = await recordingPlaybackAction(diagnosticId, questionId);
      if (!result.ok || !result.playback) {
        setGone(result.gone === true);
        setError(result.error ?? "No pudimos cargar el audio.");
        return;
      }
      setSrc({
        url: result.playback.url,
        expiresAt: new Date(result.playback.expiresAt).getTime(),
      });
      // El elemento se monta con el `src` nuevo; luego empieza a sonar.
      requestAnimationFrame(() => {
        audioRef.current?.play().catch(() => undefined);
      });
    });
  }

  /** La URL venció (o falló la red): se descarta y se pide otra al volver a escuchar. */
  function onAudioError() {
    setSrc(null);
    setError("El audio no se pudo reproducir. Vuelve a pulsar Escuchar.");
  }

  function onPlay() {
    if (src && Date.now() >= src.expiresAt) {
      audioRef.current?.pause();
      listen();
    }
  }

  function retry() {
    startRetrying(async () => {
      const result = await retryTranscriptionAction(diagnosticId, questionId);
      if (result.ok) {
        message.success(
          "Transcripción en cola. Recarga la página en unos minutos para verla.",
        );
      } else {
        message.error(result.error ?? "No pudimos reintentar la transcripción.");
      }
    });
  }

  const status = transcription ? STATUS[transcription.status] : null;

  return (
    <Flex vertical gap={8} style={{ minWidth: 0 }}>
      <Flex gap={8} align="center" wrap>
        <Tag style={{ marginInlineEnd: 0 }}>
          Respuesta por voz · {formatDuration(recording.durationMs)}
        </Tag>
        {!src && !gone && !audioDeleted && (
          <Button size="small" onClick={listen} loading={loading}>
            Escuchar
          </Button>
        )}
      </Flex>
      {audioDeleted && recording.audioDeletedAt && (
        <Typography.Text type="secondary">
          Audio borrado por plazo el <LocalDate iso={recording.audioDeletedAt} />.
          La transcripción se conserva.
        </Typography.Text>
      )}
      {src && (
        <audio
          ref={audioRef}
          src={src.url}
          controls
          // Sin descargar ni enviar a otro dispositivo (fuera de alcance).
          controlsList="nodownload noremoteplayback"
          preload="none"
          onPlay={onPlay}
          onError={onAudioError}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Grabación de la respuesta"
          style={{ width: "100%", maxWidth: 420 }}
        />
      )}
      {error && (
        <Alert
          type={gone ? "warning" : "error"}
          showIcon
          title={error}
          style={{ maxWidth: 520 }}
        />
      )}

      {status && transcription && (
        <Flex vertical gap={4}>
          <Flex gap={8} align="center" wrap>
            <Tag color={status.color} style={{ marginInlineEnd: 0 }}>
              {status.label}
            </Tag>
            {canRetry && (
              <Button size="small" onClick={retry} loading={retrying}>
                Reintentar transcripción
              </Button>
            )}
          </Flex>
          {transcription.status === "COMPLETED" &&
            (transcription.text ? (
              <Typography.Paragraph
                type="secondary"
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  marginBottom: 0,
                }}
              >
                {transcription.text}
              </Typography.Paragraph>
            ) : (
              <Typography.Text type="secondary">
                No se reconoció texto en el audio.
              </Typography.Text>
            ))}
          {transcription.status === "PENDING" && (
            <Typography.Text type="secondary">
              Puede tardar unos minutos: recarga la página para verla.
            </Typography.Text>
          )}
          {transcription.status === "FAILED" && (
            <Typography.Text type="secondary">
              {audioDeleted
                ? "No se transcribió: el audio se borró por plazo."
                : "No pudimos transcribir este audio. Puedes escucharlo o reintentar."}
            </Typography.Text>
          )}
        </Flex>
      )}
    </Flex>
  );
}
