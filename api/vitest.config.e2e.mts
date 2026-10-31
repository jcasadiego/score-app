import { defineConfig } from 'vitest/config';
import configBase from './vitest.config.mts';

// Se arma a mano en vez de con mergeConfig: mergeConfig concatena los
// `include` y correría también los tests unitarios.
export default defineConfig({
  ...configBase,
  test: {
    ...configBase.test,
    include: ['test/**/*.e2e-spec.ts'],
  },
});
