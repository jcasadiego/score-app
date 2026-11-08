import type { QuestionType } from "@/lib/diagnostics/labels";

/**
 * Espejo de `api/src/questionnaire/dto/limits.ts` y del enum
 * `QuestionnaireVersionStatus`. Si cambian allá, cambian acá.
 */
export const CODE_MAX = 64;
export const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const QUESTION_TEXT_MAX = 500;
export const HELP_TEXT_MAX = 1000;
export const OPTION_TEXT_MAX = 300;
export const FREE_TEXT_MAX_LENGTH = 5000;
/** Largo que se propone al crear una pregunta de texto libre. */
export const DEFAULT_FREE_TEXT_LENGTH = 1000;
export const MIN_CHOICE_OPTIONS = 2;
export const MAX_OPTIONS = 30;

export type QuestionnaireVersionStatus = "DRAFT" | "PUBLISHED";

export const QUESTION_TYPES: QuestionType[] = [
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "FREE_TEXT",
];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  SINGLE_CHOICE: "Selección única",
  MULTIPLE_CHOICE: "Selección múltiple",
  FREE_TEXT: "Texto libre",
};

export function isQuestionType(value: unknown): value is QuestionType {
  return QUESTION_TYPES.includes(value as QuestionType);
}

/**
 * Propone un `code`/`value` a partir de un texto: minúsculas sin tildes,
 * dígitos y guion bajo, empezando por letra.
 */
export function suggestCode(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, CODE_MAX)
    .replace(/_+$/, "");
  return slug;
}
