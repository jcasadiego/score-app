import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Contraseñas filtradas (PF-60). Dos fuentes:
 *
 * 1. Una lista local de contraseñas comunes de 12 caracteres o más
 *    (`assets/common-passwords.txt`, SecLists, MIT). Sin red.
 * 2. Pwned Passwords de Have I Been Pwned, con k-anonimato: solo salen los 5
 *    primeros caracteres del SHA-1 de la contraseña; la comparación con el
 *    resto se hace aquí. Nunca se envía la contraseña ni el correo.
 *
 * Si HIBP no responde a tiempo, vale solo la lista local: un servicio externo
 * caído no bloquea el cambio de contraseña.
 */

export const PWNED_PASSWORDS_URL = 'https://api.pwnedpasswords.com/range/';
export const HIBP_TIMEOUT_MS = 2_000;

let commonPasswords: Set<string> | null = null;

/**
 * Ruta de la lista: se busca subiendo hasta el `package.json`, igual que las
 * fuentes del PDF, para que sirva compilado (`dist/src`) y en los tests.
 */
function listPath(): string {
  let dir = __dirname;
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('No se encontró la raíz de la API');
    dir = parent;
  }
  return join(dir, 'assets', 'common-passwords.txt');
}

function loadCommonPasswords(): Set<string> {
  commonPasswords ??= new Set(
    readFileSync(listPath(), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return commonPasswords;
}

/** Si la contraseña está en la lista local (sin distinguir mayúsculas). */
export function isCommonPassword(password: string): boolean {
  return loadCommonPasswords().has(password.toLowerCase());
}

/** SHA-1 en hexadecimal mayúsculas, como lo indexa Pwned Passwords. */
export function pwnedPasswordsHash(password: string): {
  prefix: string;
  suffix: string;
} {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex');
  const upper = hash.toUpperCase();
  return { prefix: upper.slice(0, 5), suffix: upper.slice(5) };
}

/**
 * Si el sufijo aparece en la respuesta de `range/` con al menos una
 * filtración. Las líneas de relleno (`Add-Padding`) traen conteo 0.
 */
export function suffixInRange(body: string, suffix: string): boolean {
  return body.split('\n').some((line) => {
    const [candidate, count] = line.trim().split(':');
    return candidate === suffix && Number(count) > 0;
  });
}
