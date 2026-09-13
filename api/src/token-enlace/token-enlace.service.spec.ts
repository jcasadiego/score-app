import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { TokenEnlaceService } from './token-enlace.service';

describe('TokenEnlaceService', () => {
  const envOriginal = process.env;
  let service: TokenEnlaceService;

  beforeEach(() => {
    process.env = {
      ...envOriginal,
      ENLACE_JWT_SECRET: 'secreto-de-prueba',
      ENLACE_JWT_EXPIRACION: '1h',
    };
    service = new TokenEnlaceService(new JwtService());
  });

  afterEach(() => {
    process.env = envOriginal;
  });

  it('firma y verifica un token válido, devolviendo el identificador como sub', async () => {
    const token = await service.firmar('identificador-1');
    const payload = await service.verificar(token);

    expect(payload.sub).toBe('identificador-1');
  });

  it('incluye claims extra en el payload firmado', async () => {
    const token = await service.firmar('identificador-1', {
      familiaId: 'proyecto',
    });
    const payload = await service.verificar(token);

    expect(payload.familiaId).toBe('proyecto');
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const otro = new TokenEnlaceService(new JwtService());
    process.env.ENLACE_JWT_SECRET = 'otro-secreto';
    const tokenConOtroSecreto = await otro.firmar('identificador-1');

    process.env.ENLACE_JWT_SECRET = 'secreto-de-prueba';
    await expect(service.verificar(tokenConOtroSecreto)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token con formato inválido', async () => {
    await expect(service.verificar('token-invalido')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
