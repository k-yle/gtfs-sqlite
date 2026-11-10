import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/sql.worker.ts'],
    platform: 'browser',
    target: 'es2022',
    dts: true,
  },
  {
    entry: ['src/e2e.ts'],
    platform: 'node',
    target: 'es2022',
    dts: true,
    clean: false,
    fixedExtension: false,
  },
]);
