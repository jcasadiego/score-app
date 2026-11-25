import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ObjectPage,
  PutObjectInput,
  SignedReadUrlOptions,
  StorageError,
  StoragePort,
  StoredObject,
} from '../storage.port';

export interface S3StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Bucket compatible con S3 (Cloudflare R2 en QA, PF-84). El bucket es privado:
 * el navegador solo lee con una URL firmada de vida corta. Las llaves y el
 * endpoint nunca van al log; un fallo se registra solo con su nombre.
 */
export class S3StorageAdapter implements StoragePort {
  readonly driver = 's3' as const;
  private readonly logger = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig, client?: S3Client) {
    this.bucket = config.bucket;
    this.client =
      client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        // `https://<endpoint>/<bucket>/<clave>`: sirve con R2 y con cualquier
        // compatible, sin depender de DNS por bucket.
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        // R2 y otros compatibles no siempre aceptan los checksums opcionales
        // que el SDK agrega por defecto; solo cuando la operación los exige.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        maxAttempts: 3,
        requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
      });
  }

  async put({ key, body, contentType }: PutObjectInput): Promise<void> {
    await this.run('put', () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
        }),
      ),
    );
  }

  async get(key: string): Promise<StoredObject> {
    const result = await this.run('get', () =>
      this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })),
    );
    if (!(result.Body instanceof Readable)) {
      this.logger.error('Almacenamiento: get devolvió un cuerpo inesperado');
      throw new StorageError('unavailable');
    }
    return {
      stream: result.Body,
      contentType: result.ContentType ?? 'application/octet-stream',
      contentLength: result.ContentLength,
    };
  }

  async delete(key: string): Promise<void> {
    // S3 responde 204 aunque la clave no exista: ya es idempotente.
    await this.run('delete', () =>
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
  }

  getSignedReadUrl(
    key: string,
    { expiresInSeconds, contentType, contentDisposition }: SignedReadUrlOptions,
  ): Promise<string> {
    // Firmar es local (no llama al proveedor): no confirma que la clave exista.
    return this.run('sign', () =>
      getSignedUrl(
        this.client,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: contentDisposition,
        }),
        { expiresIn: expiresInSeconds },
      ),
    );
  }

  async list(prefix: string, cursor?: string): Promise<ObjectPage> {
    const result = await this.run('list', () =>
      this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${prefix}/`,
          ContinuationToken: cursor,
          MaxKeys: 1000,
        }),
      ),
    );
    return {
      objects: (result.Contents ?? [])
        .filter((o) => o.Key && o.LastModified)
        .map((o) => ({ key: o.Key!, lastModified: o.LastModified! })),
      nextCursor: result.IsTruncated ? result.NextContinuationToken : undefined,
    };
  }

  private async run<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (isNotFound(error)) throw new StorageError('not_found');
      // Solo el nombre del error: el mensaje del SDK puede traer el bucket,
      // el endpoint o la clave.
      const name = error instanceof Error ? error.name : 'unknown';
      this.logger.error(`Almacenamiento: falló ${operation} (${name})`);
      throw new StorageError('unavailable');
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'NoSuchKey' ||
      error.name === 'NotFound' ||
      error.$metadata.httpStatusCode === 404)
  );
}
