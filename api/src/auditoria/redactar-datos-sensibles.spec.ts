import { redactarDatosSensibles } from './redactar-datos-sensibles';

describe('redactarDatosSensibles', () => {
  it('redacta password en un objeto plano', () => {
    const resultado = redactarDatosSensibles({
      email: 'a@b.com',
      password: 'secreto123',
    });

    expect(resultado).toEqual({
      email: 'a@b.com',
      password: '[REDACTADO]',
    });
  });

  it('redacta claves sensibles sin importar mayúsculas/minúsculas', () => {
    const resultado = redactarDatosSensibles({ Password: 'x', TOKEN: 'y' });

    expect(resultado).toEqual({
      Password: '[REDACTADO]',
      TOKEN: '[REDACTADO]',
    });
  });

  it('redacta dentro de objetos anidados y arreglos', () => {
    const resultado = redactarDatosSensibles({
      usuarios: [{ email: 'a@b.com', passwordHash: 'hash-secreto' }],
    });

    expect(resultado).toEqual({
      usuarios: [{ email: 'a@b.com', passwordHash: '[REDACTADO]' }],
    });
  });

  it('deja intactos los valores sin claves sensibles', () => {
    const resultado = redactarDatosSensibles({ identificadorId: 'caso-1' });

    expect(resultado).toEqual({ identificadorId: 'caso-1' });
  });

  it('redacta las claves extra de la ruta, además de las globales', () => {
    const resultado = redactarDatosSensibles(
      { Email: 'a@b.com', family: 'B2B', password: 'x' },
      ['email'],
    );

    expect(resultado).toEqual({
      Email: '[REDACTADO]',
      family: 'B2B',
      password: '[REDACTADO]',
    });
  });
});
