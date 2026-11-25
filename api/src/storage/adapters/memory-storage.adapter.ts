import { Readable } from 'node:stream';
import {
  ObjectPage,
  PutObjectInput,
  SignedReadUrlOptions,
  StorageError,
  StoragePort,
  StoredObject,
} from '../storage.port';

/**
 * Almacenamiento en el proceso (desarrollo y tests): se pierde al reiniciar y
 * no se admite con NODE_ENV=production. La URL firmada es de mentira
 * (`memory://`): sirve para probar el flujo, no para reproducir en un navegador.
 */
export class MemoryStorageAdapter implements StoragePort {
  readonly driver = 'memory' as const;
  private readonly objects = new Map<
    string,
    { body: Buffer; contentType: string; lastModified: Date }
  >();

  put({ key, body, contentType }: PutObjectInput): Promise<void> {
    // Copia: quien llamó puede reutilizar su buffer.
    this.objects.set(key, {
      body: Buffer.from(body),
      contentType,
      lastModified: new Date(),
    });
    return Promise.resolve();
  }

  get(key: string): Promise<StoredObject> {
    const object = this.objects.get(key);
    if (!object) return Promise.reject(new StorageError('not_found'));
    return Promise.resolve({
      stream: Readable.from([object.body]),
      contentType: object.contentType,
      contentLength: object.body.length,
    });
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** Todo en una página: en memoria nunca son muchos. */
  list(prefix: string): Promise<ObjectPage> {
    const objects = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(`${prefix}/`))
      .map(([key, { lastModified }]) => ({ key, lastModified }));
    return Promise.resolve({ objects });
  }

  /** Solo tests: simula un objeto subido hace tiempo. */
  backdate(key: string, lastModified: Date): void {
    const object = this.objects.get(key);
    if (object) object.lastModified = lastModified;
  }

  getSignedReadUrl(
    key: string,
    { expiresInSeconds, contentType, contentDisposition }: SignedReadUrlOptions,
  ): Promise<string> {
    if (!this.objects.has(key)) {
      return Promise.reject(new StorageError('not_found'));
    }
    const expires = new Date(Date.now() + expiresInSeconds * 1000);
    const params = new URLSearchParams({
      expires: expires.toISOString(),
      contentType,
      contentDisposition,
    });
    return Promise.resolve(`memory://${key}?${params.toString()}`);
  }
}
