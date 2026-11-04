import { defineConfig } from 'vitest/config';
import configBase from './vitest.config.mts';

// Se arma a mano en vez de con mergeConfig: mergeConfig concatena los
// `include` y correría también los tests unitarios.
export default defineConfig({
  ...configBase,
  test: {
    ...configBase.test,
    include: ['test/**/*.e2e-spec.ts'],
    // Gana sobre el `.env`: los tests nunca le envían correos al proveedor real.
    // La llave de MFA es fija y solo para tests.
    env: {
      MAIL_DRIVER: 'log',
      MFA_ENCRYPTION_KEY: 'dGVzdC1rZXktbm8tdXNhci1lbi1lbnRvcm5vcy1yZWE=',
    },
  },
});
