import { Prisma } from '../../generated/prisma/client';
import { QuestionType } from '../../generated/prisma/enums';
import type {
  ScoringAnswer,
  ScoringInput,
} from '../scoring-engine/scoring-engine.port';

/**
 * Arma lo que recibe el motor a partir de las respuestas guardadas: cada
 * pregunta por su `code` y cada opción por su `value`, que se mantienen entre
 * versiones. Cuando exista la corrección del revisor (PF-39), aquí entran las
 * respuestas efectivas.
 */
export async function buildScoringInput(
  tx: Prisma.TransactionClient,
  diagnosticId: string,
): Promise<ScoringInput> {
  const diagnostic = await tx.diagnostic.findUniqueOrThrow({
    where: { id: diagnosticId },
    select: {
      questionnaireVersion: { select: { family: true, versionNumber: true } },
      answers: {
        select: {
          textValue: true,
          question: { select: { code: true, type: true, position: true } },
          selections: {
            select: { option: { select: { value: true, position: true } } },
          },
        },
      },
    },
  });

  const answers: Record<string, ScoringAnswer> = {};
  const ordered = [...diagnostic.answers].sort(
    (a, b) => a.question.position - b.question.position,
  );
  for (const answer of ordered) {
    const { code, type } = answer.question;
    if (type === QuestionType.FREE_TEXT) {
      answers[code] = answer.textValue ?? '';
      continue;
    }
    const values = answer.selections
      .map(({ option }) => option)
      .sort((a, b) => a.position - b.position)
      .map(({ value }) => value);
    answers[code] =
      type === QuestionType.SINGLE_CHOICE ? (values[0] ?? '') : values;
  }

  return {
    family: diagnostic.questionnaireVersion.family,
    questionnaireVersion: diagnostic.questionnaireVersion.versionNumber,
    answers,
  };
}
