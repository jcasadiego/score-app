/**
 * Texto de consentimiento para responder por voz (PF-87). Si cambia el texto,
 * cambia la versión, y la versión nueva se agrega también en la API
 * (`VOICE_CONSENT_VERSIONS` en `api/src/diagnostics/recording-rules.ts`).
 * Versión 2026-11-25 aprobada por José (PF-90): la transcripción se conserva
 * al borrar el audio, y el audio también se borra tras 90 días sin actividad.
 * Si la transcripción la hace un proveedor externo, el texto y su versión
 * cambian. Quien aceptó una versión anterior la vuelve a ver antes de grabar.
 */
export const VOICE_CONSENT_VERSION = "2026-11-25";

export const VOICE_CONSENT_TITLE = "Antes de grabar tu voz";

export const VOICE_CONSENT_PARAGRAPHS = [
  "Tu grabación se guarda para que el equipo de Music Finance Pro escuche tu respuesta. Un sistema automático la pasa a texto, y ese texto se usa, junto con tus demás respuestas, para preparar tu diagnóstico. No se usa para nada más.",
  "Borramos el audio 90 días después de entregarte el informe, o 90 días después de tu última actividad si no envías el diagnóstico. El texto de tu respuesta se conserva con el resto de tu diagnóstico.",
  "Mientras no envíes el diagnóstico, puedes borrar o volver a grabar tu respuesta. Grabar es opcional: siempre puedes responder por escrito.",
] as const;

/** Límites de la API (PF-86). */
export const MAX_RECORDING_MS = 3 * 60 * 1000;
export const MAX_RECORDING_BYTES = 5 * 1024 * 1024;

/** `1:05` a partir de milisegundos. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
