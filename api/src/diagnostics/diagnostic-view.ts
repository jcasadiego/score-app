import { Prisma } from '../../generated/prisma/client';
import { AUDIO_CONTENT_TYPES } from './recording-rules';
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

/** Lo que se muestra de una grabación: nunca su clave en el almacenamiento. */
export const RECORDING_SELECT = {
  format: true,
  sizeBytes: true,
  durationMs: true,
  updatedAt: true,
  audioDeletedAt: true,
} satisfies Prisma.AnswerRecordingSelect;

export const ANSWER_SELECT = {
  questionId: true,
  textValue: true,
  updatedAt: true,
  selections: { select: { optionId: true } },
  recording: { select: RECORDING_SELECT },
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

export interface RecordingView {
  contentType: string;
  sizeBytes: number;
  durationMs: number;
  updatedAt: Date;
  /** El audio se borró por plazo (PF-90); el registro queda. */
  audioDeletedAt: Date | null;
}

export interface AnswerView {
  text: string | null;
  optionIds: string[];
  /** Grabación de voz de la respuesta (PF-86), o `null`. */
  recording: RecordingView | null;
  updatedAt: Date;
}

type StoredRecording = Prisma.AnswerRecordingGetPayload<{
  select: typeof RECORDING_SELECT;
}>;

export function recordingView(recording: StoredRecording): RecordingView {
  return {
    contentType: AUDIO_CONTENT_TYPES[recording.format],
    sizeBytes: recording.sizeBytes,
    durationMs: recording.durationMs,
    updatedAt: recording.updatedAt,
    audioDeletedAt: recording.audioDeletedAt,
  };
}

export function answerView(answer: StoredAnswer): AnswerView {
  return {
    text: answer.textValue,
    optionIds: answer.selections.map(({ optionId }) => optionId),
    recording: answer.recording ? recordingView(answer.recording) : null,
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
export const VOICE_NOT_ALLOWED = 'VOICE_NOT_ALLOWED';
export const VOICE_CONSENT_REQUIRED = 'VOICE_CONSENT_REQUIRED';
export const RECORDING_TOO_LARGE = 'RECORDING_TOO_LARGE';
export const RECORDING_UNSUPPORTED_TYPE = 'RECORDING_UNSUPPORTED_TYPE';
export const RECORDING_NOT_FOUND = 'RECORDING_NOT_FOUND';
export const RECORDING_AUDIO_DELETED = 'RECORDING_AUDIO_DELETED';
