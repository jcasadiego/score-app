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

export interface SavedAnswer {
  text: string | null;
  optionIds: string[];
}

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  helpText: string | null;
  required: boolean;
  maxLength: number | null;
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
