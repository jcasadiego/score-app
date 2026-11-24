import type { Readable } from 'node:stream';

export const STORAGE_PORT = Symbol('STORAGE_PORT');

/**
 * `disabled`: no guarda nada (cada operación falla con `unavailable`).
 * `memory`: en el proceso, solo desarrollo y tests. `s3`: un bucket compatible
 * con S3 (Cloudflare R2 en QA, PF-84).
 */
export const STORAGE_DRIVERS = ['disabled', 'memory', 's3'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

export interface PutObjectInput {
  /** Clave opaca de `newObjectKey`: nunca datos personales. */
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StoredObject {
  stream: Readable;
  contentType: string;
  contentLength?: number;
}

export interface SignedReadUrlOptions {
  expiresInSeconds: number;
  /** El navegador recibe este tipo aunque el objeto diga otro. */
  contentType: string;
  /** Por ejemplo `inline` (audio) o `attachment`. */
  contentDisposition: 'inline' | 'attachment';
}

/**
 * `unavailable`: el proveedor falló o el almacenamiento está desactivado (el
 * llamador lo traduce a 503). `not_found`: la clave no existe (404).
 */
export type StorageFailureReason = 'unavailable' | 'not_found';

/** Un fallo ya clasificado. Nunca lleva llaves, endpoint ni el mensaje del proveedor. */
export class StorageError extends Error {
  constructor(readonly reason: StorageFailureReason) {
    super(`Falló el almacenamiento: ${reason}`);
    this.name = 'StorageError';
  }
}

/**
 * Límite entre la API y el almacenamiento de objetos (mismo criterio que el
 * correo y la IA). Los módulos no lo usan directo: pasan por `StorageService`,
 * que valida las claves y el plazo de las URLs firmadas.
 */
export interface StoragePort {
  readonly driver: StorageDriver;
  put(input: PutObjectInput): Promise<void>;
  get(key: string): Promise<StoredObject>;
  /** Idempotente: borrar una clave que no existe no falla. */
  delete(key: string): Promise<void>;
  getSignedReadUrl(key: string, options: SignedReadUrlOptions): Promise<string>;
}
