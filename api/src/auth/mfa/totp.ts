import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
/** Tolera un intervalo de desfase del reloj del teléfono en cada sentido. */
const WINDOW = 1;
/** 160 bits, lo que recomienda RFC 4226 para HMAC-SHA1. */
const SECRET_BYTES = 20;

export function generateTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

export function toBase32(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return bits > 0 ? output + BASE32[(value << (5 - bits)) & 31] : output;
}

/** HOTP de RFC 4226, que TOTP (RFC 6238) calcula sobre el intervalo de tiempo. */
export function totpAtStep(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/** El intervalo en que el código es válido, o `null`. Compara todos los candidatos. */
export function findTotpStep(
  secret: Buffer,
  code: string,
  nowMs = Date.now(),
): number | null {
  const received = Buffer.from(code.padEnd(DIGITS, ' ').slice(0, DIGITS));
  const now = currentStep(nowMs);
  let match: number | null = null;
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    if (timingSafeEqual(Buffer.from(totpAtStep(secret, step)), received)) {
      match = step;
    }
  }
  return match;
}

export function totpUri(secret: Buffer, account: string): string {
  const issuer = 'SCORE Panel';
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: toBase32(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, '%20')}`;
}
