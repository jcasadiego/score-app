import { SetMetadata } from '@nestjs/common';

export const CLAVES_REDACTAR_AUDITORIA = 'clavesRedactarAuditoria';

/**
 * Claves extra a redactar en la bitácora para una ruta puntual, además de
 * las sensibles globales de `redactarDatosSensibles` (passwords, tokens).
 * Pensado para datos personales que en otras rutas sí conviene conservar
 * en la traza (ej. `email` al crear un usuario del panel).
 */
export const RedactarEnAuditoria = (...claves: string[]) =>
  SetMetadata(CLAVES_REDACTAR_AUDITORIA, claves);
