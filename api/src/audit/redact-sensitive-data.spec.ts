import { redactSensitiveData } from './redact-sensitive-data';

describe('redactSensitiveData', () => {
  it('redacta password en un objeto plano', () => {
    const result = redactSensitiveData({
      family: 'B2B',
      password: 'secreto123',
    });

    expect(result).toEqual({
      family: 'B2B',
      password: '[REDACTADO]',
    });
  });

  it('redacta claves sensibles sin importar mayúsculas/minúsculas', () => {
    const result = redactSensitiveData({ Password: 'x', TOKEN: 'y' });

    expect(result).toEqual({
      Password: '[REDACTADO]',
      TOKEN: '[REDACTADO]',
    });
  });

  it('redacta dentro de objetos anidados y arreglos', () => {
    const result = redactSensitiveData({
      users: [{ family: 'B2B', passwordHash: 'hash-secreto' }],
    });

    expect(result).toEqual({
      users: [{ family: 'B2B', passwordHash: '[REDACTADO]' }],
    });
  });

  it('deja intactos los valores sin claves sensibles', () => {
    const result = redactSensitiveData({ subjectId: 'caso-1' });

    expect(result).toEqual({ subjectId: 'caso-1' });
  });

  it('oculta los datos personales: la bitácora no se puede borrar', () => {
    expect(
      redactSensitiveData({
        name: 'Ana',
        email: 'a@b.com',
        phone: '123',
        family: 'B2B',
      }),
    ).toEqual({
      name: '[REDACTADO]',
      email: '[REDACTADO]',
      phone: '[REDACTADO]',
      family: 'B2B',
    });
  });
});
