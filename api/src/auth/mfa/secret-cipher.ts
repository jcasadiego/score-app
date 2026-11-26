import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/** `v2.<llave>.<iv>.<tag>.<datos>`: lleva el id de la llave que lo cifró. */
const VERSION = 'v2';
/** `v1.<iv>.<tag>.<datos>`, de antes de PF-57: sin id de llave. */
const LEGACY_VERSION = 'v1';

function decodeKey(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

function currentKey(): Buffer {
  return decodeKey(process.env.MFA_ENCRYPTION_KEY ?? '');
}

/** Las llaves anteriores, solo para descifrar mientras dura una rotación. */
function previousKeys(): Buffer[] {
  return (process.env.MFA_ENCRYPTION_PREVIOUS_KEYS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(decodeKey);
}

/**
 * Id público de una llave: un hash truncado con prefijo propio. No permite
 * recuperar la llave y evita probar todas al descifrar.
 */
export function mfaKeyId(key: Buffer): string {
  return createHash('sha256')
    .update('score-mfa-key-id:')
    .update(key)
    .digest('base64url')
    .slice(0, 11);
}

/** Prefijo de lo cifrado con la llave actual: lo que ya no hay que recifrar. */
export function currentMfaPrefix(): string {
  return `${VERSION}.${mfaKeyId(currentKey())}.`;
}

/**
 * AES-256-GCM. El id del usuario va como dato autenticado: un secreto copiado a
 * la fila de otra cuenta no se descifra. Siempre cifra con la llave actual.
 */
export function encryptMfaSecret(secret: Buffer, userId: string): string {
  const key = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [
    VERSION,
    mfaKeyId(key),
    ...[iv, cipher.getAuthTag(), data].map((part) =>
      part.toString('base64url'),
    ),
  ].join('.');
}

/**
 * Descifra con la llave actual o una anterior. Una llave desconocida o un dato
 * alterado lanzan: nunca se devuelve un secreto que no se pudo autenticar.
 */
export function decryptMfaSecret(stored: string, userId: string): Buffer {
  const parts = stored.split('.');
  const keys = [currentKey(), ...previousKeys()];

  if (parts[0] === VERSION && parts.length === 5) {
    const [, keyId, iv, tag, data] = parts;
    const key = keys.find((candidate) => mfaKeyId(candidate) === keyId);
    if (!key) {
      throw new Error(
        'El secreto MFA se cifró con una llave que ya no está configurada',
      );
    }
    return decrypt(key, iv, tag, data, userId);
  }

  if (parts[0] === LEGACY_VERSION && parts.length === 4) {
    // Sin id de llave: se prueba cada una. GCM rechaza la equivocada.
    const [, iv, tag, data] = parts;
    for (const key of keys) {
      try {
        return decrypt(key, iv, tag, data, userId);
      } catch {
        // Siguiente llave.
      }
    }
    throw new Error(
      'El secreto MFA no se descifra con ninguna de las llaves configuradas',
    );
  }

  throw new Error('Versión de secreto MFA no reconocida');
}

function decrypt(
  key: Buffer,
  iv: string,
  tag: string,
  data: string,
  userId: string,
): Buffer {
  // Largo del tag fijo: sin esto, GCM aceptaría un tag recortado.
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64url'),
    { authTagLength: 16 },
  );
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]);
}
