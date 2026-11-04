import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function key(): Buffer {
  return Buffer.from(process.env.MFA_ENCRYPTION_KEY ?? '', 'base64');
}

/**
 * AES-256-GCM. El id del usuario va como dato autenticado: un secreto copiado a
 * la fila de otra cuenta no se descifra. La versión permite rotar el formato.
 */
export function encryptMfaSecret(secret: Buffer, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) =>
      typeof part === 'string' ? part : part.toString('base64url'),
    )
    .join('.');
}

export function decryptMfaSecret(stored: string, userId: string): Buffer {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== VERSION) {
    throw new Error('Versión de secreto MFA no reconocida');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]);
}
