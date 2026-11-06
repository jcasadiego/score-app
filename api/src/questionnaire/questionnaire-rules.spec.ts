import { QuestionType } from '../../generated/prisma/enums';
import { publicationIssues, questionIssues } from './questionnaire-rules';

const choice = (
  values: string[],
  type: QuestionType = QuestionType.SINGLE_CHOICE,
) => ({
  code: 'q',
  type,
  options: values.map((value) => ({ value })),
});

const codes = (issues: { code?: string }[]) => issues.map((i) => i.code);

describe('questionIssues', () => {
  it('acepta una selección con dos opciones distintas', () => {
    expect(questionIssues(choice(['a', 'b']))).toEqual([]);
    expect(
      questionIssues(choice(['a', 'b'], QuestionType.MULTIPLE_CHOICE)),
    ).toEqual([]);
  });

  it('exige al menos dos opciones en una selección', () => {
    expect(codes(questionIssues(choice(['a'])))).toEqual([
      'NOT_ENOUGH_OPTIONS',
    ]);
    expect(codes(questionIssues(choice([])))).toEqual(['NOT_ENOUGH_OPTIONS']);
  });

  it('no admite largo máximo en una selección', () => {
    expect(
      codes(questionIssues({ ...choice(['a', 'b']), maxLength: 10 })),
    ).toEqual(['MAX_LENGTH_NOT_ALLOWED']);
  });

  it('detecta valores repetidos', () => {
    expect(codes(questionIssues(choice(['a', 'b', 'a'])))).toEqual([
      'DUPLICATE_OPTION_VALUE',
    ]);
  });

  it('texto libre: largo máximo obligatorio y sin opciones', () => {
    const freeText = { code: 'f', type: QuestionType.FREE_TEXT, options: [] };
    expect(questionIssues({ ...freeText, maxLength: 100 })).toEqual([]);
    expect(codes(questionIssues(freeText))).toEqual(['MAX_LENGTH_REQUIRED']);
    expect(
      codes(
        questionIssues({
          ...freeText,
          maxLength: 100,
          options: [{ value: 'a' }],
        }),
      ),
    ).toEqual(['FREE_TEXT_WITH_OPTIONS']);
  });

  it('antepone el campo cuando se le indica', () => {
    expect(questionIssues(choice(['a']), 'questions[2]')[0].field).toBe(
      'questions[2].options',
    );
  });
});

describe('publicationIssues', () => {
  it('exige al menos una pregunta', () => {
    expect(codes(publicationIssues([]))).toEqual(['NO_QUESTIONS']);
  });

  it('lista los problemas de cada pregunta con su posición', () => {
    const issues = publicationIssues([choice(['a', 'b']), choice(['a'])]);
    expect(issues).toEqual([
      expect.objectContaining({
        field: 'questions[1].options',
        code: 'NOT_ENOUGH_OPTIONS',
      }),
    ]);
  });

  it('vacío si está lista', () => {
    expect(publicationIssues([choice(['a', 'b'])])).toEqual([]);
  });
});
