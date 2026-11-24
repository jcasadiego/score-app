import { randomUUID } from 'node:crypto';

/** Carpetas permitidas en el bucket. Una nueva se agrega aquí, a propósito. */
export const OBJECT_KEY_PREFIXES = ['voice'] as const;
export type ObjectKeyPrefix = (typeof OBJECT_KEY_PREFIXES)[number];

const OBJECT_KEY = new RegExp(
  `^(${OBJECT_KEY_PREFIXES.join('|')})/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
);

/**
 * Clave opaca para un objeto nuevo: carpeta + UUID v4 aleatorio. Nunca lleva
 * nombre, correo ni ids del dominio, para que el bucket por sí solo no
 * permita vincular un audio con una persona.
 */
export function newObjectKey(prefix: ObjectKeyPrefix): string {
  return `${prefix}/${randomUUID()}`;
}

export function isObjectKey(key: string): boolean {
  return OBJECT_KEY.test(key);
}
