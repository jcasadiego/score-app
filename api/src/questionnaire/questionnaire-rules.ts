import { QuestionType } from '../../generated/prisma/enums';
import { ProblemError } from '../common/problem-details';
import { MIN_CHOICE_OPTIONS } from './dto/limits';

export interface QuestionShape {
  code: string;
  type: QuestionType;
  maxLength?: number | null;
  options: { value: string }[];
}

/**
 * Reglas que cruzan campos de una pregunta y que los DTOs no expresan. Se usan
 * al crearla o editarla (400) y otra vez al publicar (409), por si algo entró a
 * la base por otro camino.
 */
export function questionIssues(
  question: QuestionShape,
  field = '',
): ProblemError[] {
  const at = (name: string) => (field ? `${field}.${name}` : name);
  const issues: ProblemError[] = [];
  const isFreeText = question.type === QuestionType.FREE_TEXT;

  if (isFreeText) {
    if (question.options.length > 0) {
      issues.push({
        field: at('options'),
        code: 'FREE_TEXT_WITH_OPTIONS',
        message: `La pregunta ${question.code} es de texto libre y no admite opciones.`,
      });
    }
    if (question.maxLength == null) {
      issues.push({
        field: at('maxLength'),
        code: 'MAX_LENGTH_REQUIRED',
        message: `La pregunta ${question.code} es de texto libre y necesita un largo máximo.`,
      });
    }
  } else {
    if (question.options.length < MIN_CHOICE_OPTIONS) {
      issues.push({
        field: at('options'),
        code: 'NOT_ENOUGH_OPTIONS',
        message: `La pregunta ${question.code} es de selección y necesita al menos ${MIN_CHOICE_OPTIONS} opciones.`,
      });
    }
    if (question.maxLength != null) {
      issues.push({
        field: at('maxLength'),
        code: 'MAX_LENGTH_NOT_ALLOWED',
        message: `La pregunta ${question.code} es de selección: el largo máximo solo aplica a texto libre.`,
      });
    }
  }

  const values = question.options.map((option) => option.value);
  const repeated = values.filter((value, i) => values.indexOf(value) !== i);
  if (repeated.length > 0) {
    issues.push({
      field: at('options'),
      code: 'DUPLICATE_OPTION_VALUE',
      message: `La pregunta ${question.code} repite el valor ${[...new Set(repeated)].join(', ')} en sus opciones.`,
    });
  }

  return issues;
}

/** Lo que le falta a un borrador para poder publicarse. Vacío si está listo. */
export function publicationIssues(questions: QuestionShape[]): ProblemError[] {
  if (questions.length === 0) {
    return [
      {
        code: 'NO_QUESTIONS',
        message: 'La versión necesita al menos una pregunta.',
      },
    ];
  }
  return questions.flatMap((question, i) =>
    questionIssues(question, `questions[${i}]`),
  );
}
