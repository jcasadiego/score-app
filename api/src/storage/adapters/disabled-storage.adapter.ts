import { StorageError, StoragePort } from '../storage.port';

/** Almacenamiento apagado (`STORAGE_DRIVER=disabled`): todo responde `unavailable`. */
export class DisabledStorageAdapter implements StoragePort {
  readonly driver = 'disabled' as const;

  put(): Promise<void> {
    return Promise.reject(new StorageError('unavailable'));
  }

  get(): Promise<never> {
    return Promise.reject(new StorageError('unavailable'));
  }

  delete(): Promise<void> {
    return Promise.reject(new StorageError('unavailable'));
  }

  getSignedReadUrl(): Promise<string> {
    return Promise.reject(new StorageError('unavailable'));
  }
}
