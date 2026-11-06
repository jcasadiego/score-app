import { hashToken, newLinkToken } from './password-link.service';

describe('newLinkToken', () => {
  it('guarda solo el SHA-256 del token y vence según la vigencia pedida', () => {
    const before = Date.now();
    const { token, record } = newLinkToken(60_000);

    // 32 bytes aleatorios en base64url.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(record.tokenHash).toBe(hashToken(token));
    expect(record.tokenHash).not.toContain(token);
    expect(record.expiresAt.getTime() - before).toBeGreaterThanOrEqual(60_000);
    expect(record.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it('nunca repite el token', () => {
    expect(newLinkToken(1).token).not.toBe(newLinkToken(1).token);
  });
});
