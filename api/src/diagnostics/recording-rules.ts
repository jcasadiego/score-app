import { AudioFormat } from '../../generated/prisma/enums';

/** Límites de PF-86, decididos por José el 2026-11-24 (CHECK en la base). */
export const MAX_RECORDING_BYTES = 5 * 1024 * 1024;
export const MAX_RECORDING_DURATION_MS = 3 * 60 * 1000;

/**
 * Versiones del texto de consentimiento que muestra `apps/diagnostico`. Una
 * versión nueva del texto se agrega aquí, sin quitar las anteriores (quedan
 * guardadas en diagnósticos ya aceptados).
 */
export const VOICE_CONSENT_VERSIONS = ['2026-11-24', '2026-11-25'] as const;

/** Lo que se sirve al reproducir, sea cual sea el tipo que declaró el navegador. */
export const AUDIO_CONTENT_TYPES: Record<AudioFormat, string> = {
  [AudioFormat.WEBM]: 'audio/webm',
  [AudioFormat.MP4]: 'audio/mp4',
};

/** Tipos que declaran Chrome/Firefox (WebM) y Safari (MP4), sin parámetros. */
const DECLARED_FORMATS: Record<string, AudioFormat> = {
  'audio/webm': AudioFormat.WEBM,
  'audio/mp4': AudioFormat.MP4,
  'audio/x-m4a': AudioFormat.MP4,
};

const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/**
 * Detecta el formato por el contenido y exige que coincida con el tipo
 * declarado. `null` si no es WebM ni MP4, o si el tipo declarado miente: la
 * extensión o el `Content-Type` del navegador no bastan.
 */
export function detectAudioFormat(
  body: Buffer,
  declaredType: string,
): AudioFormat | null {
  const declared =
    DECLARED_FORMATS[declaredType.split(';')[0].trim().toLowerCase()];
  if (!declared) return null;

  const detected = sniff(body);
  return detected === declared ? detected : null;
}

function sniff(body: Buffer): AudioFormat | null {
  // WebM: cabecera EBML con DocType "webm" al principio.
  if (
    body.subarray(0, 4).equals(EBML_MAGIC) &&
    body.subarray(0, 64).includes('webm', 0, 'latin1')
  ) {
    return AudioFormat.WEBM;
  }
  // MP4/M4A: caja `ftyp` en el byte 4.
  if (body.length >= 12 && body.toString('latin1', 4, 8) === 'ftyp') {
    return AudioFormat.MP4;
  }
  return null;
}
