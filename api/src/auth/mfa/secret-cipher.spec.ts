import { decryptMfaSecret, encryptMfaSecret } from './secret-cipher';

describe('Cifrado del secreto MFA', () => {
  const secret = Buffer.from('12345678901234567890');

  beforeEach(() => {
    process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  it('descifra lo que cifró, sin guardar el secreto en claro', () => {
    const stored = encryptMfaSecret(secret, 'u1');

    expect(stored).not.toContain(secret.toString('base64url'));
    expect(decryptMfaSecret(stored, 'u1')).toEqual(secret);
  });

  it('no se descifra para otra cuenta ni con otra llave', () => {
    const stored = encryptMfaSecret(secret, 'u1');
    expect(() => decryptMfaSecret(stored, 'u2')).toThrow();

    process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
    expect(() => decryptMfaSecret(stored, 'u1')).toThrow();
  });

  it('dos cifrados del mismo secreto no se parecen', () => {
    expect(encryptMfaSecret(secret, 'u1')).not.toBe(
      encryptMfaSecret(secret, 'u1'),
    );
  });
});
