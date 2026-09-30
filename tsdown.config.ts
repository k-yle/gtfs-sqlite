import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/sql.worker.ts'],
  platform: 'browser',
  target: 'es2022',
  dts: true,
});
