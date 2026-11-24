/** Lo que devuelve `GET /diagnostic-sessions/current` (PF-16). */

export type QuestionType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "FREE_TEXT";

export type ExternalPlatform =
  | "SPOTIFY"
  | "YOUTUBE"
  | "INSTAGRAM"
  | "TIKTOK"
  | "WEBSITE";

export interface AnswerOption {
  id: string;
  text: string;
  position: number;
}

/** Grabación de voz guardada de una respuesta (PF-86). */
export interface SavedRecording {
  contentType: string;
  sizeBytes: number;
  durationMs: number;
  updatedAt: string;
}

export interface SavedAnswer {
  text: string | null;
  optionIds: string[];
  recording: SavedRecording | null;
}

/** URL firmada de vida corta para escuchar una grabación. */
export interface RecordingPlayback {
  url: string;
  expiresAt: string;
  contentType: string;
  durationMs: number;
}

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  helpText: string | null;
  required: boolean;
  maxLength: number | null;
  /** Acepta también una respuesta por voz (solo texto libre). */
  allowsVoice: boolean;
  options: AnswerOption[];
  answer: SavedAnswer | null;
}

export interface ExternalLink {
  platform: ExternalPlatform;
  url: string;
}

export interface CurrentDiagnostic {
  status: "ACTIVE" | "IN_PROGRESS" | "COMPLETED" | string;
  lead: { name: string };
  questions: Question[];
  externalLinks: ExternalLink[];
  progress: { answered: number; total: number };
  /** Versión del texto de consentimiento de voz que aceptó, o `null`. */
  voiceConsentVersion: string | null;
}

/** Error de una pregunta o campo, de `errors` en RFC 9457. */
export interface FieldError {
  field?: string;
  code?: string;
  message: string;
}

/**
 * Resultado de una Server Action. Nunca se lanza el error: en producción Next
 * oculta el mensaje de una excepción, y el cliente necesita `code` y `status`.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      code?: string;
      message: string;
      errors?: FieldError[];
    };
