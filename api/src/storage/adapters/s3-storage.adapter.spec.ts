import { Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { StorageError } from '../storage.port';
import { S3StorageAdapter } from './s3-storage.adapter';

const CONFIG = {
  endpoint: 'https://cuenta.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'score-voice-qa',
  accessKeyId: 'AKIDPRUEBA',
  secretAccessKey: 'secreto-que-no-debe-salir',
};
const KEY = 'voice/0b7e7c1e-8c4a-4f2a-9a3e-1d2c3b4a5f6e';

describe('S3StorageAdapter', () => {
  let send: ReturnType<typeof vi.fn>;
  let adapter: S3StorageAdapter;
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    send = vi.fn();
    adapter = new S3StorageAdapter(CONFIG, { send } as unknown as S3Client);
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('sube al bucket configurado con tipo y tamaño', async () => {
    send.mockResolvedValue({});
    await adapter.put({
      key: KEY,
      body: Buffer.from('abc'),
      contentType: 'audio/webm',
    });

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'score-voice-qa',
      Key: KEY,
      ContentType: 'audio/webm',
      ContentLength: 3,
    });
  });

  it('lista por carpeta y página, con el cursor del proveedor', async () => {
    const at = new Date('2026-11-01T00:00:00Z');
    send.mockResolvedValue({
      Contents: [{ Key: KEY, LastModified: at }, { Key: undefined }],
      IsTruncated: true,
      NextContinuationToken: 'siguiente',
    });
    const page = await adapter.list('voice', 'anterior');

    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect(command.input).toMatchObject({
      Bucket: 'score-voice-qa',
      Prefix: 'voice/',
      ContinuationToken: 'anterior',
    });
    expect(page).toEqual({
      objects: [{ key: KEY, lastModified: at }],
      nextCursor: 'siguiente',
    });
  });

  it('la última página no trae cursor', async () => {
    send.mockResolvedValue({ Contents: [], IsTruncated: false });
    expect(await adapter.list('voice')).toEqual({ objects: [] });
  });

  it('lee el objeto como stream', async () => {
    send.mockResolvedValue({
      Body: Readable.from([Buffer.from('abc')]),
      ContentType: 'audio/mp4',
      ContentLength: 3,
    });
    const object = await adapter.get(KEY);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    expect(object.contentType).toBe('audio/mp4');
    expect(object.contentLength).toBe(3);
  });

  it('borra por clave', async () => {
    send.mockResolvedValue({});
    await adapter.delete(KEY);
    expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('una clave inexistente responde not_found', async () => {
    send.mockRejectedValue(
      new NoSuchKey({
        message: 'no existe',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    await expect(adapter.get(KEY)).rejects.toEqual(
      new StorageError('not_found'),
    );
  });

  it('un fallo del proveedor responde unavailable y el log no trae detalles', async () => {
    send.mockRejectedValue(
      new S3ServiceException({
        name: 'InternalError',
        $fault: 'server',
        message: `fallo en ${CONFIG.endpoint}/${CONFIG.bucket}/${KEY}`,
        $metadata: { httpStatusCode: 500 },
      }),
    );
    await expect(
      adapter.put({
        key: KEY,
        body: Buffer.from('x'),
        contentType: 'audio/webm',
      }),
    ).rejects.toEqual(new StorageError('unavailable'));

    const logged = JSON.stringify(logError.mock.calls);
    expect(logged).toContain('InternalError');
    for (const secret of [
      CONFIG.endpoint,
      CONFIG.bucket,
      KEY,
      CONFIG.secretAccessKey,
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('firma una URL de lectura con vida corta y tipo forzado, sin exponer el secreto', async () => {
    const real = new S3StorageAdapter(CONFIG);
    const url = new URL(
      await real.getSignedReadUrl(KEY, {
        expiresInSeconds: 300,
        contentType: 'audio/webm',
        contentDisposition: 'inline',
      }),
    );
    expect(url.hostname).toBe('cuenta.r2.cloudflarestorage.com');
    expect(url.pathname).toBe(`/score-voice-qa/${KEY}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-type')).toBe('audio/webm');
    expect(url.searchParams.get('response-content-disposition')).toBe('inline');
    expect(url.toString()).not.toContain(CONFIG.secretAccessKey);
  });
});
