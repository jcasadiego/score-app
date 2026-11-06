import { QuestionType } from '../../generated/prisma/enums';
import { validateAnswer } from './answer-rules';

const options = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }];
const single = { type: QuestionType.SINGLE_CHOICE, maxLength: null, options };
const multiple = {
  type: QuestionType.MULTIPLE_CHOICE,
  maxLength: null,
  options,
};
const freeText = { type: QuestionType.FREE_TEXT, maxLength: 10, options: [] };

describe('validateAnswer', () => {
  it('guarda el texto libre recortado', () => {
    expect(validateAnswer(freeText, { text: '  hola  ' })).toEqual({
      answer: { textValue: 'hola', optionIds: [] },
    });
  });

  it('rechaza un texto más largo que el máximo de la pregunta', () => {
    expect(validateAnswer(freeText, { text: 'x'.repeat(11) })).toHaveProperty(
      'errors',
    );
  });

  it('rechaza un texto vacío y opciones en una pregunta de texto', () => {
    expect(validateAnswer(freeText, { text: '   ' })).toHaveProperty('errors');
    expect(
      validateAnswer(freeText, { text: 'ok', optionIds: ['o1'] }),
    ).toHaveProperty('errors');
  });

  it('la selección única acepta una sola opción', () => {
    expect(validateAnswer(single, { optionIds: ['o1'] })).toEqual({
      answer: { textValue: null, optionIds: ['o1'] },
    });
    expect(validateAnswer(single, { optionIds: ['o1', 'o2'] })).toHaveProperty(
      'errors',
    );
  });

  it('la selección múltiple acepta varias, sin repetir', () => {
    expect(validateAnswer(multiple, { optionIds: ['o1', 'o3', 'o1'] })).toEqual(
      { answer: { textValue: null, optionIds: ['o1', 'o3'] } },
    );
  });

  it('rechaza opciones de otra pregunta, ninguna opción o texto', () => {
    expect(validateAnswer(multiple, { optionIds: ['otra'] })).toHaveProperty(
      'errors',
    );
    expect(validateAnswer(multiple, { optionIds: [] })).toHaveProperty(
      'errors',
    );
    expect(validateAnswer(single, { text: 'x' })).toHaveProperty('errors');
  });
});
