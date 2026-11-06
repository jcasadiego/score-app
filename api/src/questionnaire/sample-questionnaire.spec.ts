import {
  SAMPLE_PREFIX,
  SAMPLE_QUESTIONNAIRE,
  sampleDataAllowed,
} from '../../prisma/sample-questionnaire';
import { QuestionType } from '../../generated/prisma/enums';
import {
  CODE_MAX,
  CODE_PATTERN,
  HELP_TEXT_MAX,
  OPTION_TEXT_MAX,
  QUESTION_TEXT_MAX,
} from './dto/limits';
import { questionIssues } from './questionnaire-rules';

describe('cuestionario de prueba', () => {
  const families = Object.entries(SAMPLE_QUESTIONNAIRE);

  it('cubre las cuatro familias', () => {
    expect(families.map(([family]) => family).sort()).toEqual([
      'B2B',
      'CATALOG',
      'PROFESSIONAL',
      'PROJECT',
    ]);
  });

  it.each(families)(
    '%s: 5-6 preguntas válidas que mezclan los tres tipos',
    (_, questions) => {
      expect(questions.length).toBeGreaterThanOrEqual(5);
      expect(questions.length).toBeLessThanOrEqual(6);
      expect(new Set(questions.map((q) => q.type))).toEqual(
        new Set(Object.values(QuestionType)),
      );
      expect(new Set(questions.map((q) => q.code)).size).toBe(questions.length);

      for (const question of questions) {
        const options = (question.options ?? []).map(([value, text]) => ({
          value,
          text,
        }));
        expect(questionIssues({ ...question, options })).toEqual([]);
        expect(question.code).toMatch(CODE_PATTERN);
        expect(question.code.length).toBeLessThanOrEqual(CODE_MAX);
        expect((SAMPLE_PREFIX + question.text).length).toBeLessThanOrEqual(
          QUESTION_TEXT_MAX,
        );
        expect(question.helpText.length).toBeGreaterThan(0);
        expect(question.helpText.length).toBeLessThanOrEqual(HELP_TEXT_MAX);
        for (const { value, text } of options) {
          expect(value).toMatch(CODE_PATTERN);
          expect(text.length).toBeLessThanOrEqual(OPTION_TEXT_MAX);
        }
      }
    },
  );
});

describe('sampleDataAllowed', () => {
  it.each([
    [{ NODE_ENV: 'development' }, true],
    [{ NODE_ENV: 'test' }, false],
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production', APP_ENV: 'qa' }, true],
    [{ NODE_ENV: 'production', APP_ENV: 'production' }, false],
    [{ NODE_ENV: 'development', APP_ENV: 'production' }, false],
    [{ NODE_ENV: 'development', APP_ENV: 'development' }, true],
  ])('%o → %s', (env, allowed) => {
    expect(sampleDataAllowed(env as NodeJS.ProcessEnv)).toBe(allowed);
  });
});
