import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// there's a bug in parcel that we need to workaround,
// it doesn't properly emit declarations for `export type {...}`
// so we have this ridiculous hack

const filePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../dist/index.d.ts',
);

const original = await fs.readFile(filePath, 'utf8');

const short = 'SqlWorker';
const long = 'dangerouslyUseSqlWorkerFromMainThread';

const updated = original.replaceAll(long, short).replace(
  `export class ${short} {`,
  `
export type { ${short} };
export { ${short} as ${long} };
declare class ${short} {`,
);

await fs.writeFile(filePath, updated);
