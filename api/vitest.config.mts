import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC en vez de esbuild: esbuild no emite la metadata de decoradores
// (emitDecoratorMetadata) de la que depende la inyección de Nest.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['src/**/*.spec.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      reportsDirectory: './coverage',
    },
  },
});
