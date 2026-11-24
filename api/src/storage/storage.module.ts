import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ValidatedEnv } from '../config/validate-env';
import { DisabledStorageAdapter } from './adapters/disabled-storage.adapter';
import { MemoryStorageAdapter } from './adapters/memory-storage.adapter';
import { S3StorageAdapter } from './adapters/s3-storage.adapter';
import { STORAGE_PORT, StoragePort } from './storage.port';
import { StorageService } from './storage.service';

/** Almacenamiento de objetos (PF-85). Sin rutas: lo usan otros módulos (voz). */
@Module({
  providers: [
    StorageService,
    {
      // `validateEnv` ya garantiza las variables de `s3` y que `memory` no
      // llegue a producción. Vacío en desarrollo y tests = `memory`.
      provide: STORAGE_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ValidatedEnv, true>): StoragePort => {
        const driver =
          config.get('STORAGE_DRIVER', { infer: true }) ?? 'memory';
        if (driver === 'disabled') return new DisabledStorageAdapter();
        if (driver === 'memory') return new MemoryStorageAdapter();
        return new S3StorageAdapter({
          endpoint: config.get('STORAGE_S3_ENDPOINT', { infer: true })!,
          region: config.get('STORAGE_S3_REGION', { infer: true }),
          bucket: config.get('STORAGE_S3_BUCKET', { infer: true })!,
          accessKeyId: config.get('STORAGE_S3_ACCESS_KEY_ID', { infer: true })!,
          secretAccessKey: config.get('STORAGE_S3_SECRET_ACCESS_KEY', {
            infer: true,
          })!,
        });
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
