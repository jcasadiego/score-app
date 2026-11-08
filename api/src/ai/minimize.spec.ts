import { describe, expect, it } from 'vitest';
import { ContactDataError, minimize } from './minimize';

describe('minimize', () => {
  it.each([
    'name',
    'email',
    'phone',
    'nombre',
    'correo',
    'teléfono',
    'fullName',
  ])('rechaza la clave de contacto "%s", también anidada', (key) => {
    expect(() => minimize({ answers: { [key]: 'x' } })).toThrow(
      ContactDataError,
    );
  });

  it('no rechaza códigos que solo contienen "name"', () => {
    expect(minimize({ artist_name_known: 'yes' })).toEqual({
      artist_name_known: 'yes',
    });
  });

  it('enmascara correos y teléfonos dentro de los textos', () => {
    const result = minimize({
      story: 'Escríbeme a ana.perez@correo.com o al +57 300 123 4567.',
    });
    expect(result.story).toBe('Escríbeme a [correo] o al [teléfono].');
  });

  it('conserva montos y números cortos, que pueden importar para la tarea', () => {
    const result = minimize({ budget: 'Unos 1.500.000 en 12 meses' });
    expect(result.budget).toBe('Unos 1.500.000 en 12 meses');
  });

  it('enmascara los textos pedidos (como el nombre del lead) sin importar mayúsculas', () => {
    const result = minimize(
      { story: ['Soy ANA PÉREZ y produzco', 'nada más'] },
      ['Ana Pérez'],
    );
    expect(result.story).toEqual([
      'Soy [dato personal] y produzco',
      'nada más',
    ]);
  });

  it('no modifica el objeto original', () => {
    const data = { story: 'ana@correo.com' };
    minimize(data);
    expect(data.story).toBe('ana@correo.com');
  });
});
