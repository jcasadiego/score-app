import { createCipheriv, randomBytes } from 'node:crypto';
import {
  currentMfaPrefix,
  decryptMfaSecret,
  encryptMfaSecret,
  mfaKeyId,
} from './secret-cipher';

const OLD_KEY = Buffer.alloc(32, 7);
const NEW_KEY = Buffer.alloc(32, 8);
const OTHER_KEY = Buffer.alloc(32, 9);

function useKeys(current: Buffer, previous: Buffer[] = []) {
  process.env.MFA_ENCRYPTION_KEY = current.toString('base64');
  process.env.MFA_ENCRYPTION_PREVIOUS_KEYS = previous
    .map((key) => key.toString('base64'))
    .join(',');
}

/** Formato v1, de antes de PF-57, tal como lo guardaba la versión anterior. */
function encryptV1(key: Buffer, secret: Buffer, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(secret), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((part) =>
      typeof part === 'string' ? part : part.toString('base64url'),
    )
    .join('.');
}

describe('Cifrado del secreto MFA', () => {
  const secret = Buffer.from('12345678901234567890');

  beforeEach(() => useKeys(OLD_KEY));
  afterAll(() => {
    delete process.env.MFA_ENCRYPTION_PREVIOUS_KEYS;
  });

  it('descifra lo que cifró, sin guardar el secreto en claro', () => {
    const stored = encryptMfaSecret(secret, 'u1');

    expect(stored).not.toContain(secret.toString('base64url'));
    expect(stored.startsWith(currentMfaPrefix())).toBe(true);
    expect(decryptMfaSecret(stored, 'u1')).toEqual(secret);
  });

  it('no se descifra para otra cuenta ni con otra llave', () => {
    const stored = encryptMfaSecret(secret, 'u1');
    expect(() => decryptMfaSecret(stored, 'u2')).toThrow();

    useKeys(NEW_KEY);
    expect(() => decryptMfaSecret(stored, 'u1')).toThrow(
      /llave que ya no está configurada/,
    );
  });

  it('dos cifrados del mismo secreto no se parecen', () => {
    expect(encryptMfaSecret(secret, 'u1')).not.toBe(
      encryptMfaSecret(secret, 'u1'),
    );
  });

  it('el id de la llave no es la llave', () => {
    const id = mfaKeyId(OLD_KEY);
    expect(id).toHaveLength(11);
    expect(OLD_KEY.toString('base64')).not.toContain(id);
    expect(mfaKeyId(NEW_KEY)).not.toBe(id);
  });

  describe('rotación (PF-57)', () => {
    it('con la llave vieja entre las anteriores, sigue descifrando', () => {
      const stored = encryptMfaSecret(secret, 'u1');

      useKeys(NEW_KEY, [OTHER_KEY, OLD_KEY]);

      expect(decryptMfaSecret(stored, 'u1')).toEqual(secret);
      // Y lo nuevo sale con la llave actual.
      expect(
        encryptMfaSecret(secret, 'u1').startsWith(currentMfaPrefix()),
      ).toBe(true);
      expect(stored.startsWith(currentMfaPrefix())).toBe(false);
    });

    it('descifra el formato v1 con la llave actual o con una anterior', () => {
      const legacy = encryptV1(OLD_KEY, secret, 'u1');
      expect(decryptMfaSecret(legacy, 'u1')).toEqual(secret);

      useKeys(NEW_KEY, [OLD_KEY]);
      expect(decryptMfaSecret(legacy, 'u1')).toEqual(secret);

      useKeys(NEW_KEY);
      expect(() => decryptMfaSecret(legacy, 'u1')).toThrow(
        /ninguna de las llaves/,
      );
    });

    it('rechaza un tag recortado, un dato alterado o un formato desconocido', () => {
      const stored = encryptMfaSecret(secret, 'u1');
      const [version, keyId, iv, tag, data] = stored.split('.');
      const shortTag = Buffer.from(tag, 'base64url')
        .subarray(0, 4)
        .toString('base64url');

      expect(() =>
        decryptMfaSecret([version, keyId, iv, shortTag, data].join('.'), 'u1'),
      ).toThrow();
      expect(() =>
        decryptMfaSecret(
          [version, keyId, iv, tag, `${data.slice(0, -2)}AA`].join('.'),
          'u1',
        ),
      ).toThrow();
      expect(() => decryptMfaSecret(`v9.${iv}.${tag}.${data}`, 'u1')).toThrow(
        /Versión de secreto MFA no reconocida/,
      );
    });
  });
});
