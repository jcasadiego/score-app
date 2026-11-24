import { ConfigService } from '@nestjs/config';
import { text } from 'node:stream/consumers';
import { ValidatedEnv } from '../config/validate-env';
import { DisabledStorageAdapter } from './adapters/disabled-storage.adapter';
import { MemoryStorageAdapter } from './adapters/memory-storage.adapter';
import { isObjectKey, newObjectKey } from './object-key';
import { StorageError, StoragePort } from './storage.port';
import { StorageService } from './storage.service';

function serviceWith(port: StoragePort, ttl = 300) {
  const config = { get: vi.fn().mockReturnValue(ttl) };
  return new StorageService(
    port,
    config as unknown as ConfigService<ValidatedEnv, true>,
  );
}

describe('newObjectKey', () => {
  it('genera claves opacas y distintas en la carpeta pedida', () => {
    const a = newObjectKey('voice');
    const b = newObjectKey('voice');
    expect(a).toMatch(/^voice\/[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
    expect(isObjectKey(a)).toBe(true);
  });

  it('rechaza claves con texto libre, rutas o carpetas desconocidas', () => {
    for (const key of [
      'voice/ana@example.com',
      'voice/../secreto',
      'otra/0b7e7c1e-8c4a-4f2a-9a3e-1d2c3b4a5f6e',
      '/voice/0b7e7c1e-8c4a-4f2a-9a3e-1d2c3b4a5f6e',
      '',
    ]) {
      expect(isObjectKey(key)).toBe(false);
    }
  });
});

describe('StorageService con el adaptador en memoria', () => {
  let service: StorageService;

  beforeEach(() => {
    service = serviceWith(new MemoryStorageAdapter());
  });

  it('guarda, lee y borra un objeto', async () => {
    const key = newObjectKey('voice');
    await service.put({
      key,
      body: Buffer.from('audio de prueba'),
      contentType: 'audio/webm',
    });

    const object = await service.get(key);
    expect(object.contentType).toBe('audio/webm');
    expect(object.contentLength).toBe(15);
    expect(await text(object.stream)).toBe('audio de prueba');

    await service.delete(key);
    await expect(service.get(key)).rejects.toEqual(
      new StorageError('not_found'),
    );
  });

  it('deleteQuietly no lanza si el almacenamiento falla', async () => {
    const quiet = serviceWith(new DisabledStorageAdapter());
    await expect(
      quiet.deleteQuietly(newObjectKey('voice')),
    ).resolves.toBeUndefined();
  });

  it('borrar una clave que no existe no falla', async () => {
    await expect(
      service.delete(newObjectKey('voice')),
    ).resolves.toBeUndefined();
  });

  it('no se ve afectado si quien llamó reutiliza su buffer', async () => {
    const key = newObjectKey('voice');
    const body = Buffer.from('original');
    await service.put({ key, body, contentType: 'audio/mp4' });
    body.fill(0);
    expect(await text((await service.get(key)).stream)).toBe('original');
  });

  it('firma una URL con el plazo configurado y el tipo forzado', async () => {
    const key = newObjectKey('voice');
    await service.put({
      key,
      body: Buffer.from('x'),
      contentType: 'audio/webm',
    });

    const before = Date.now();
    const signed = await service.getSignedReadUrl(key, {
      contentType: 'audio/webm',
      contentDisposition: 'inline',
    });
    const url = new URL(signed.url);
    const expires = Date.parse(url.searchParams.get('expires')!);
    expect(Math.abs(signed.expiresAt.getTime() - expires)).toBeLessThan(1_000);
    expect(expires - before).toBeGreaterThanOrEqual(299_000);
    expect(expires - before).toBeLessThanOrEqual(301_000);
    expect(url.searchParams.get('contentType')).toBe('audio/webm');
    expect(url.searchParams.get('contentDisposition')).toBe('inline');
  });

  it('nunca firma por más de 15 minutos, aunque se pida', async () => {
    const port = new MemoryStorageAdapter();
    const sign = vi.spyOn(port, 'getSignedReadUrl');
    const key = newObjectKey('voice');
    await port.put({ key, body: Buffer.from('x'), contentType: 'audio/webm' });

    await serviceWith(port).getSignedReadUrl(key, {
      expiresInSeconds: 86_400,
      contentType: 'audio/webm',
      contentDisposition: 'inline',
    });
    expect(sign.mock.calls[0][1].expiresInSeconds).toBe(900);
  });

  it('firmar una clave inexistente responde not_found', async () => {
    await expect(
      service.getSignedReadUrl(newObjectKey('voice'), {
        contentType: 'audio/webm',
        contentDisposition: 'inline',
      }),
    ).rejects.toEqual(new StorageError('not_found'));
  });

  it('rechaza claves que no salen de newObjectKey, sin llegar al adaptador', async () => {
    const port = new MemoryStorageAdapter();
    const put = vi.spyOn(port, 'put');
    expect(() =>
      serviceWith(port).put({
        key: 'voice/ana@example.com',
        body: Buffer.from('x'),
        contentType: 'audio/webm',
      }),
    ).toThrow(/Clave de objeto inválida/);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('StorageService desactivado', () => {
  it('toda operación responde unavailable', async () => {
    const service = serviceWith(new DisabledStorageAdapter());
    const key = newObjectKey('voice');
    const unavailable = new StorageError('unavailable');

    expect(service.driver).toBe('disabled');
    await expect(
      service.put({ key, body: Buffer.from('x'), contentType: 'audio/webm' }),
    ).rejects.toEqual(unavailable);
    await expect(service.get(key)).rejects.toEqual(unavailable);
    await expect(service.delete(key)).rejects.toEqual(unavailable);
    await expect(
      service.getSignedReadUrl(key, {
        contentType: 'audio/webm',
        contentDisposition: 'inline',
      }),
    ).rejects.toEqual(unavailable);
  });
});
