import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrearLeadDto, UTM_MAX } from './crear-lead.dto';

const VALIDO = {
  name: 'Ana Pérez',
  email: 'ana@example.com',
  family: 'PROJECT',
};

async function propiedadesConError(datos: Record<string, unknown>) {
  const errores = await validate(plainToInstance(CrearLeadDto, datos));
  return errores.map((e) => e.property);
}

describe('CrearLeadDto', () => {
  it('normaliza nombre y email, y acepta los opcionales vacíos', async () => {
    const dto = plainToInstance(CrearLeadDto, {
      ...VALIDO,
      name: '  Ana   Pérez ',
      email: ' Ana@Example.COM ',
    });

    expect(dto.name).toBe('Ana Pérez');
    expect(dto.email).toBe('ana@example.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta teléfono y UTMs válidos', async () => {
    expect(
      await propiedadesConError({
        ...VALIDO,
        phone: '+52 (55) 1234-5678',
        utmSource: 'instagram',
        utmMedium: 'social',
        utmCampaign: 'lanzamiento',
      }),
    ).toEqual([]);
  });

  it('rechaza campos requeridos faltantes', async () => {
    expect(await propiedadesConError({})).toEqual(
      expect.arrayContaining(['name', 'email', 'family']),
    );
  });

  it('rechaza email mal formado, familia desconocida y teléfono inválido', async () => {
    expect(
      await propiedadesConError({
        ...VALIDO,
        email: 'no-es-email',
        family: 'OTRA',
        phone: 'llámame',
      }),
    ).toEqual(expect.arrayContaining(['email', 'family', 'phone']));
  });

  it('rechaza UTMs más largos que el límite', async () => {
    expect(
      await propiedadesConError({
        ...VALIDO,
        utmCampaign: 'a'.repeat(UTM_MAX + 1),
      }),
    ).toEqual(['utmCampaign']);
  });
});
