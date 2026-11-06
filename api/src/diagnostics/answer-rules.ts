import { QuestionType } from '../../generated/prisma/enums';
import type { ProblemError } from '../common/problem-details';

export interface AnswerInput {
  text?: string;
  optionIds?: string[];
}

export interface AnsweredQuestion {
  type: QuestionType;
  maxLength: number | null;
  options: { id: string }[];
}

/** Lo que se guarda de una respuesta válida. */
export type ValidAnswer =
  | { textValue: string; optionIds: [] }
  | { textValue: null; optionIds: string[] };

/**
 * Valida una respuesta contra su pregunta. La base garantiza además que cada
 * opción sea de esa pregunta (FK compuesta); aquí se da el mensaje claro.
 */
export function validateAnswer(
  question: AnsweredQuestion,
  input: AnswerInput,
): { answer: ValidAnswer } | { errors: ProblemError[] } {
  if (question.type === QuestionType.FREE_TEXT) {
    if (input.optionIds !== undefined) {
      return {
        errors: [
          {
            field: 'optionIds',
            message: 'Esta pregunta es de texto libre: no admite opciones.',
          },
        ],
      };
    }
    const text = input.text?.trim() ?? '';
    if (!text) {
      return {
        errors: [
          { field: 'text', message: 'La respuesta no puede estar vacía.' },
        ],
      };
    }
    if (question.maxLength !== null && text.length > question.maxLength) {
      return {
        errors: [
          {
            field: 'text',
            message: `La respuesta no puede superar ${question.maxLength} caracteres.`,
          },
        ],
      };
    }
    return { answer: { textValue: text, optionIds: [] } };
  }

  if (input.text !== undefined) {
    return {
      errors: [
        {
          field: 'text',
          message: 'Esta pregunta es de selección: no admite texto.',
        },
      ],
    };
  }
  const optionIds = [...new Set(input.optionIds ?? [])];
  if (optionIds.length === 0) {
    return {
      errors: [{ field: 'optionIds', message: 'Elige al menos una opción.' }],
    };
  }
  if (question.type === QuestionType.SINGLE_CHOICE && optionIds.length > 1) {
    return {
      errors: [{ field: 'optionIds', message: 'Elige una sola opción.' }],
    };
  }
  const known = new Set(question.options.map(({ id }) => id));
  if (optionIds.some((id) => !known.has(id))) {
    return {
      errors: [
        {
          field: 'optionIds',
          message: 'Alguna de las opciones no es de esta pregunta.',
        },
      ],
    };
  }
  return { answer: { textValue: null, optionIds } };
}
