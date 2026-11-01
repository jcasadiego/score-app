import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLeadDto, UTM_MAX } from './create-lead.dto';

const VALID = {
  name: 'Ana Pérez',
  email: 'ana@example.com',
  family: 'PROJECT',
};

async function propertiesWithErrors(data: Record<string, unknown>) {
  const errors = await validate(plainToInstance(CreateLeadDto, data));
  return errors.map((e) => e.property);
}

describe('CreateLeadDto', () => {
  it('normaliza nombre y email, y acepta los opcionales vacíos', async () => {
    const dto = plainToInstance(CreateLeadDto, {
      ...VALID,
      name: '  Ana   Pérez ',
      email: ' Ana@Example.COM ',
    });

    expect(dto.name).toBe('Ana Pérez');
    expect(dto.email).toBe('ana@example.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('acepta teléfono y UTMs válidos', async () => {
    expect(
      await propertiesWithErrors({
        ...VALID,
        phone: '+52 (55) 1234-5678',
        utmSource: 'instagram',
        utmMedium: 'social',
        utmCampaign: 'lanzamiento',
      }),
    ).toEqual([]);
  });

  it('rechaza campos requeridos faltantes', async () => {
    expect(await propertiesWithErrors({})).toEqual(
      expect.arrayContaining(['name', 'email', 'family']),
    );
  });

  it('rechaza email mal formado, familia desconocida y teléfono inválido', async () => {
    expect(
      await propertiesWithErrors({
        ...VALID,
        email: 'no-es-email',
        family: 'OTRA',
        phone: 'llámame',
      }),
    ).toEqual(expect.arrayContaining(['email', 'family', 'phone']));
  });

  it('rechaza UTMs más largos que el límite', async () => {
    expect(
      await propertiesWithErrors({
        ...VALID,
        utmCampaign: 'a'.repeat(UTM_MAX + 1),
      }),
    ).toEqual(['utmCampaign']);
  });
});
