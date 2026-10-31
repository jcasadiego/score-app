import { redactSensitiveData } from './redact-sensitive-data';

describe('redactSensitiveData', () => {
  it('redacta password en un objeto plano', () => {
    const result = redactSensitiveData({
      email: 'a@b.com',
      password: 'secreto123',
    });

    expect(result).toEqual({
      email: 'a@b.com',
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
      users: [{ email: 'a@b.com', passwordHash: 'hash-secreto' }],
    });

    expect(result).toEqual({
      users: [{ email: 'a@b.com', passwordHash: '[REDACTADO]' }],
    });
  });

  it('deja intactos los valores sin claves sensibles', () => {
    const result = redactSensitiveData({ subjectId: 'caso-1' });

    expect(result).toEqual({ subjectId: 'caso-1' });
  });

  it('redacta las claves extra de la ruta, además de las globales', () => {
    const result = redactSensitiveData(
      { Email: 'a@b.com', family: 'B2B', password: 'x' },
      ['email'],
    );

    expect(result).toEqual({
      Email: '[REDACTADO]',
      family: 'B2B',
      password: '[REDACTADO]',
    });
  });
});
