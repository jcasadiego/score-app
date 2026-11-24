/**
 * Prueba manual del almacenamiento (`pnpm storage:test`, PF-85). Con la
 * configuración de `.env` (`STORAGE_DRIVER` y, con `s3`, endpoint, bucket y
 * llaves) guarda un objeto de prueba, lo lee, firma una URL y la descarga,
 * comprueba que sin firma el bucket rechaza el acceso y lo borra. No necesita
 * Postgres. No imprime llaves ni la URL firmada completa.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { text } from 'node:stream/consumers';
import { validateEnv } from '../src/config/validate-env';
import { newObjectKey } from '../src/storage/object-key';
import { StorageError } from '../src/storage/storage.port';
import { StorageModule } from '../src/storage/storage.module';
import { StorageService } from '../src/storage/storage.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    StorageModule,
  ],
})
class StorageSmokeModule {}

const BODY = `prueba de almacenamiento SCORE ${new Date().toISOString()}`;

function check(ok: boolean, label: string): void {
  console.log(`${ok ? '✔' : '✘'} ${label}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const app = await NestFactory.createApplicationContext(StorageSmokeModule, {
    logger: ['error', 'warn'],
  });
  const storage = app.get(StorageService);
  const key = newObjectKey('voice');
  console.log(`Driver: ${storage.driver} · clave de prueba: ${key}`);
  try {
    await storage.put({
      key,
      body: Buffer.from(BODY),
      contentType: 'text/plain',
    });
    check(true, 'Guardar');

    const object = await storage.get(key);
    check((await text(object.stream)) === BODY, 'Leer (mismo contenido)');

    const signed = await storage.getSignedReadUrl(key, {
      expiresInSeconds: 60,
      contentType: 'text/plain',
      contentDisposition: 'inline',
    });
    if (storage.driver === 's3') {
      const withSignature = await fetch(signed);
      check(
        withSignature.status === 200 && (await withSignature.text()) === BODY,
        `URL firmada responde 200 (${withSignature.status})`,
      );
      const url = new URL(signed);
      const anonymous = await fetch(`${url.origin}${url.pathname}`);
      check(
        anonymous.status >= 400 && anonymous.status < 500,
        `Sin firma, el bucket rechaza el acceso (${anonymous.status})`,
      );
      const listing = await fetch(
        `${url.origin}/${url.pathname.split('/')[1]}/`,
      );
      check(
        listing.status >= 400 && listing.status < 500,
        `Sin firma, el bucket no se puede listar (${listing.status})`,
      );
    } else {
      check(signed.startsWith('memory://'), 'URL firmada (simulada)');
    }

    await storage.delete(key);
    const gone = await storage.get(key).then(
      () => false,
      (error) => error instanceof StorageError && error.reason === 'not_found',
    );
    check(gone, 'Borrar (ya no existe)');
  } catch (error) {
    console.error(
      error instanceof StorageError
        ? `Falló: ${error.reason}`
        : `Falló: ${error instanceof Error ? error.message : 'error desconocido'}`,
    );
    process.exitCode = 1;
    await storage.delete(key).catch(() => undefined);
  } finally {
    await app.close();
  }
}

void main();
