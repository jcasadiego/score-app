import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AccessLinkService } from './access-link.service';

describe('AccessLinkService', () => {
  const originalEnv = process.env;
  let service: AccessLinkService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      ACCESS_LINK_JWT_SECRET: 'secreto-de-prueba',
      ACCESS_LINK_JWT_EXPIRES_IN: '1h',
    };
    service = new AccessLinkService(new JwtService());
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('firma y verifica un token válido, devolviendo el identificador como sub', async () => {
    const token = await service.sign('identificador-1');
    const payload = await service.verify(token);

    expect(payload.sub).toBe('identificador-1');
  });

  it('incluye claims extra en el payload firmado', async () => {
    const token = await service.sign('identificador-1', {
      familyId: 'proyecto',
    });
    const payload = await service.verify(token);

    expect(payload.familyId).toBe('proyecto');
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const other = new AccessLinkService(new JwtService());
    process.env.ACCESS_LINK_JWT_SECRET = 'otro-secreto';
    const tokenWithOtherSecret = await other.sign('identificador-1');

    process.env.ACCESS_LINK_JWT_SECRET = 'secreto-de-prueba';
    await expect(service.verify(tokenWithOtherSecret)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token con formato inválido', async () => {
    await expect(service.verify('token-invalido')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
