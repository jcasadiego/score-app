import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnv } from '../config/validate-env';
import { isObjectKey } from './object-key';
import {
  PutObjectInput,
  STORAGE_PORT,
  SignedReadUrlOptions,
  StorageDriver,
  StorageError,
  StoragePort,
  StoredObject,
} from './storage.port';

export interface SignedReadUrl {
  url: string;
  expiresAt: Date;
}

/** Tope de una URL firmada, aunque el llamador o la variable pidan más. */
export const MAX_SIGNED_URL_TTL_SECONDS = 900;

/**
 * Lo que usan los módulos para guardar archivos. Solo acepta claves de
 * `newObjectKey` (opacas, sin datos personales) y acota la vida de las URLs
 * firmadas. Un fallo llega como `StorageError`: el llamador lo traduce a
 * 503 (`unavailable`) o 404 (`not_found`) con RFC 9457.
 */
@Injectable()
export class StorageService {
  private readonly signedUrlTtlSeconds: number;
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly port: StoragePort,
    config: ConfigService<ValidatedEnv, true>,
  ) {
    this.signedUrlTtlSeconds = config.get('STORAGE_SIGNED_URL_TTL_SECONDS', {
      infer: true,
    });
  }

  get driver(): StorageDriver {
    return this.port.driver;
  }

  put(input: PutObjectInput): Promise<void> {
    assertObjectKey(input.key);
    return this.port.put(input);
  }

  get(key: string): Promise<StoredObject> {
    assertObjectKey(key);
    return this.port.get(key);
  }

  delete(key: string): Promise<void> {
    assertObjectKey(key);
    return this.port.delete(key);
  }

  async getSignedReadUrl(
    key: string,
    options: Omit<SignedReadUrlOptions, 'expiresInSeconds'> & {
      expiresInSeconds?: number;
    },
  ): Promise<SignedReadUrl> {
    assertObjectKey(key);
    const requested = options.expiresInSeconds ?? this.signedUrlTtlSeconds;
    const expiresInSeconds = Math.max(
      1,
      Math.min(requested, MAX_SIGNED_URL_TTL_SECONDS),
    );
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const url = await this.port.getSignedReadUrl(key, {
      ...options,
      expiresInSeconds,
    });
    return { url, expiresAt };
  }

  /**
   * Borra sin lanzar: para limpiar un objeto que ya no apunta ningún registro.
   * Si falla, queda huérfano y lo borra la limpieza de PF-90.
   */
  async deleteQuietly(key: string): Promise<void> {
    try {
      await this.delete(key);
    } catch (error) {
      const reason = error instanceof StorageError ? error.reason : 'unknown';
      this.logger.warn(`No se pudo borrar un objeto huérfano (${reason})`);
    }
  }
}

/** Un error de programación, no del cliente: la clave siempre sale de `newObjectKey`. */
function assertObjectKey(key: string): void {
  if (!isObjectKey(key)) {
    throw new Error('Clave de objeto inválida: use newObjectKey');
  }
}
