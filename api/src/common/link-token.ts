import { createHash, randomBytes } from 'node:crypto';

/**
 * SHA-256 del token de un enlace. El token es aleatorio de 256 bits, así que
 * no hace falta un hash lento como argon2.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Token nuevo en claro (va solo en el correo) y lo que se guarda de él. */
export function newLinkToken(ttlMs: number) {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    record: {
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  };
}
