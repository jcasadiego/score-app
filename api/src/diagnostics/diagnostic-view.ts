import { Prisma } from '../../generated/prisma/client';
import { QUESTION_SELECT } from '../questionnaire/questionnaire-versions.service';

/** Preguntas de la versión del diagnóstico, en orden. */
export const VERSION_QUESTIONS_SELECT = {
  family: true,
  versionNumber: true,
  questions: {
    select: QUESTION_SELECT,
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.QuestionnaireVersionSelect;

export const ANSWER_SELECT = {
  questionId: true,
  textValue: true,
  updatedAt: true,
  selections: { select: { optionId: true } },
} satisfies Prisma.AnswerSelect;

export const EXTERNAL_LINK_SELECT = {
  platform: true,
  url: true,
  updatedAt: true,
} satisfies Prisma.ExternalLinkSelect;

type VersionQuestions = Prisma.QuestionnaireVersionGetPayload<{
  select: typeof VERSION_QUESTIONS_SELECT;
}>;
type StoredAnswer = Prisma.AnswerGetPayload<{ select: typeof ANSWER_SELECT }>;

export interface AnswerView {
  text: string | null;
  optionIds: string[];
  updatedAt: Date;
}

export function answerView(answer: StoredAnswer): AnswerView {
  return {
    text: answer.textValue,
    optionIds: answer.selections.map(({ optionId }) => optionId),
    updatedAt: answer.updatedAt,
  };
}

/** Cada pregunta con su respuesta (o `null`), y el progreso. */
export function questionsWithAnswers(
  version: VersionQuestions,
  answers: StoredAnswer[],
) {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const questions = version.questions.map((question) => {
    const answer = byQuestion.get(question.id);
    return { ...question, answer: answer ? answerView(answer) : null };
  });
  return {
    questions,
    progress: {
      answered: questions.filter(({ answer }) => answer !== null).length,
      total: questions.length,
    },
  };
}

/** Códigos propios del módulo (catálogo en `docs/errores.md`). */
export const DIAGNOSTIC_ALREADY_EXISTS = 'DIAGNOSTIC_ALREADY_EXISTS';
export const NO_PUBLISHED_QUESTIONNAIRE = 'NO_PUBLISHED_QUESTIONNAIRE';
export const DIAGNOSTIC_COMPLETED = 'DIAGNOSTIC_COMPLETED';
export const DIAGNOSTIC_INCOMPLETE = 'DIAGNOSTIC_INCOMPLETE';
