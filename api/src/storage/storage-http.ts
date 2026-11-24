import {
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StorageError } from './storage.port';

/** Códigos propios (catálogo en `docs/errores.md`). */
export const STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE';

/**
 * Traduce un `StorageError` a RFC 9457 (503 o 404), sin detalles del
 * proveedor. Cualquier otro error sigue su curso.
 */
export function storageHttpError(
  error: unknown,
  notFoundCode: string,
): unknown {
  if (!(error instanceof StorageError)) return error;
  if (error.reason === 'not_found') {
    return new NotFoundException({
      message: 'El archivo ya no está disponible.',
      code: notFoundCode,
    });
  }
  return new ServiceUnavailableException({
    message:
      'No pudimos acceder al almacenamiento de audios. Intenta de nuevo.',
    code: STORAGE_UNAVAILABLE,
  }) as HttpException;
}
