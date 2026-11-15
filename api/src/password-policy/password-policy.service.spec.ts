import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ValidatedEnv } from '../config/validate-env';
import {
  isCommonPassword,
  pwnedPasswordsHash,
  suffixInRange,
} from './breached-passwords';
import {
  PASSWORD_BREACHED_CODE,
  PasswordPolicyService,
} from './password-policy.service';

const SAFE = 'tortuga-violeta-lunes-1987';

function serviceWith(provider: 'hibp' | 'local') {
  const config = { get: vi.fn().mockReturnValue(provider) };
  return new PasswordPolicyService(
    config as unknown as ConfigService<ValidatedEnv, true>,
  );
}

function rangeWith(password: string, count: number): string {
  const { suffix } = pwnedPasswordsHash(password);
  return `0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${suffix}:${count}\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0`;
}

describe('lista local', () => {
  it('reconoce una contraseña común sin distinguir mayúsculas', () => {
    expect(isCommonPassword('password1234')).toBe(true);
    expect(isCommonPassword('PassWord1234')).toBe(true);
    expect(isCommonPassword(SAFE)).toBe(false);
  });
});

describe('k-anonimato', () => {
  it('parte el SHA-1 en prefijo de 5 y sufijo de 35, en mayúsculas', () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    expect(pwnedPasswordsHash('password')).toEqual({
      prefix: '5BAA6',
      suffix: '1E4C9B93F3F0682250B6CF8331B7EE68FD8',
    });
  });

  it('ignora las líneas de relleno con conteo 0', () => {
    const { suffix } = pwnedPasswordsHash(SAFE);
    expect(suffixInRange(`${suffix}:0`, suffix)).toBe(false);
    expect(suffixInRange(`${suffix}:3`, suffix)).toBe(true);
  });
});

describe('PasswordPolicyService', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('rechaza una contraseña de la lista local con field = password', async () => {
    const error = await serviceWith('local')
      .assertNotBreached('password1234')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ field: 'password', code: PASSWORD_BREACHED_CODE }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consulta HIBP solo con el prefijo y rechaza si el sufijo está filtrado', async () => {
    fetchMock.mockResolvedValue(new Response(rangeWith(SAFE, 42)));

    await expect(
      serviceWith('hibp').assertNotBreached(SAFE),
    ).rejects.toBeInstanceOf(BadRequestException);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.pwnedpasswords.com/range/${pwnedPasswordsHash(SAFE).prefix}`,
    );
    expect(url).not.toContain(pwnedPasswordsHash(SAFE).suffix);
    expect(JSON.stringify(init)).not.toContain(SAFE);
    expect(init.headers).toMatchObject({ 'Add-Padding': 'true' });
  });

  it('acepta si HIBP no la conoce', async () => {
    fetchMock.mockResolvedValue(new Response(rangeWith('otra-cosa', 5)));

    await expect(
      serviceWith('hibp').assertNotBreached(SAFE),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['no responde', () => fetchMock.mockRejectedValue(new Error('timeout'))],
    [
      'responde con error',
      () => fetchMock.mockResolvedValue(new Response('', { status: 503 })),
    ],
  ])('si HIBP %s, no bloquea el cambio', async (_, arrange) => {
    arrange();
    await expect(
      serviceWith('hibp').assertNotBreached(SAFE),
    ).resolves.toBeUndefined();
  });

  it('con el proveedor local no sale a la red', async () => {
    await serviceWith('local').assertNotBreached(SAFE);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
