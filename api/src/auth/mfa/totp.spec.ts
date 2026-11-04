import { findTotpStep, toBase32, totpAtStep, totpUri } from './totp';

// Vectores del apéndice B de RFC 6238, recortados a 6 dígitos.
const RFC_SECRET = Buffer.from('12345678901234567890');
const VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
  [20000000000, '353130'],
];

describe('TOTP', () => {
  it.each(VECTORS)('coincide con RFC 6238 en t=%i', (seconds, code) => {
    expect(totpAtStep(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
  });

  it('codifica en base32 según RFC 4648', () => {
    expect(toBase32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(toBase32(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('acepta un intervalo de desfase, y nada más', () => {
    const now = 1_111_111_111_000;
    const step = Math.floor(now / 30_000);
    const at = (offset: number) => totpAtStep(RFC_SECRET, step + offset);

    expect(findTotpStep(RFC_SECRET, at(0), now)).toBe(step);
    expect(findTotpStep(RFC_SECRET, at(-1), now)).toBe(step - 1);
    expect(findTotpStep(RFC_SECRET, at(1), now)).toBe(step + 1);
    expect(findTotpStep(RFC_SECRET, at(-2), now)).toBeNull();
    expect(findTotpStep(RFC_SECRET, at(2), now)).toBeNull();
  });

  it('rechaza un código mal formado sin lanzar', () => {
    expect(findTotpStep(RFC_SECRET, '12')).toBeNull();
    expect(findTotpStep(RFC_SECRET, '')).toBeNull();
  });

  it('arma una URI que entienden las apps de autenticación', () => {
    expect(totpUri(RFC_SECRET, 'ana@example.com')).toBe(
      'otpauth://totp/SCORE%20Panel:ana%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=SCORE%20Panel&algorithm=SHA1&digits=6&period=30',
    );
  });
});
