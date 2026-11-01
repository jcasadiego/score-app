import { SetMetadata } from '@nestjs/common';

export const AUDIT_REDACT_KEYS = 'auditRedactKeys';

/**
 * Claves extra a redactar en la bitácora para una ruta puntual, además de
 * las sensibles globales de `redactSensitiveData` (passwords, tokens).
 * Pensado para datos personales que en otras rutas sí conviene conservar
 * en la traza (ej. `email` al crear un usuario del panel).
 */
export const RedactInAudit = (...keys: string[]) =>
  SetMetadata(AUDIT_REDACT_KEYS, keys);
