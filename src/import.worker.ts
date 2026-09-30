import { unzip } from 'unzipit';
import { parse as parseCsv } from 'papaparse';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { DB_SCHEMA, type GtfsFile, PRIMARY_KEYS, type Table } from 'gtfs-types';
import type { importDBFromZip } from './import';

/** emit a progress update event for every n rows */
const PROGRESS_UPDATE_INTERVAL = 10_000;

const isValidFile = (fileName: string): fileName is GtfsFile =>
  fileName in PRIMARY_KEYS;

/** @internal exported only for unit tests */
export function createSqlCommands(columns: string[], tableName: Table) {
  const fileName: GtfsFile = `${tableName}.txt`;
  const pk = PRIMARY_KEYS[fileName];
  const pkCmd = pk
    ? Array.isArray(pk)
      ? `, PRIMARY KEY (${pk.filter((field) => columns.includes(field)).join(', ')})`
      : `, PRIMARY KEY (${pk})`
    : '';

  const columnsWithTypes = columns
    .map((cell) => {
      const customDataType = DB_SCHEMA[fileName][<never>cell] as
        | string
        | undefined;

      return customDataType ? `${cell} ${customDataType.toUpperCase()}` : cell;
    })
    .join(', ');

  return {
    create: [
      `DROP TABLE IF EXISTS ${tableName}`,
      `CREATE TABLE ${tableName}(${columnsWithTypes}${pkCmd})`,
    ],
    insert: `INSERT INTO ${tableName}(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
  };
}

async function importFiles(
  database: Database,
  zipFile: File,
  exclude: GtfsFile[] | undefined,
  progress: importDBFromZip.Progress,
  log: (message?: string) => void,
) {
  log('unzipping…');
  const { entries } = await unzip(zipFile);

  for (const file in entries) {
    if (isValidFile(file)) {
      progress.perFile[file] = { done: 0, total: 0 };
    } else {
      progress.warnings.add(`Skipping unknown file “${file}”`);
    }
  }
  log();

  const filesBySize = Object.keys(entries)
    .filter(isValidFile)
    .sort((a, b) => entries[a]!.size - entries[b]!.size);

  for (const fileName of filesBySize) {
    if (exclude?.includes(fileName)) continue;

    log(`[${fileName}] Reading into memory…`);
    const csv = parseCsv<string[]>(await entries[fileName]!.text());

    progress.perFile[fileName]!.total = csv.data.length - 2;

    const header = csv.data.shift()!;
    const tableName = <Table>fileName.split('.')[0];

    log(`[${fileName}] Preparing table…`);
    const commands = createSqlCommands(header, tableName);
    for (const command of commands.create) database.exec(command);

    const remainingSeconds: number[] = [];
    let t = performance.now();

    database.exec('BEGIN');
    const insert = database.prepare(commands.insert);
    for (let index = 0; index < csv.data.length; index++) {
      const row = csv.data[index]!;

      if (!(!row.length || (row.length === 1 && !row[0]))) {
        row[0] = row[0]!.trim(); // if files use a broken mix of \r\n, strip new lines from the first cell
        insert.clearBindings().bind(row).stepReset();
      }

      // progress update
      if (!(index % PROGRESS_UPDATE_INTERVAL) || index >= csv.data.length - 3) {
        const tʹ = performance.now();

        progress.perFile[fileName]!.done = index;
        if (index) {
          const delta =
            (tʹ - t) *
            (csv.data.length - index) *
            PROGRESS_UPDATE_INTERVAL ** -1 *
            1e-3;
          const MAX = 10;
          if (remainingSeconds.unshift(delta) > 10) {
            remainingSeconds.length = MAX;
          }

          // use the average of the last few chumks so that the estimate
          // time doesn't jump around too much.
          const avg =
            remainingSeconds.reduce((a, b) => a + b, 0) /
            remainingSeconds.length;
          log(`[${fileName}] Importing, ${Math.round(avg)}s remaining…`);
        }
        t = tʹ;
      }
    }
    insert.finalize();
    database.exec('COMMIT');
  }
}

/** @internal */
export async function importIntoMemory(
  sqlite3: Sqlite3Static,
  { zipFile, exclude }: importDBFromZip.Options,
  onProgress: (progress: importDBFromZip.Progress) => void,
) {
  const progress: importDBFromZip.Progress = {
    message: 'creating in-memory sqlite database…',
    perFile: {},
    warnings: new Set(),
  };
  const log = (message?: string) => {
    if (message) {
      console.log(message);
      progress.message = message;
    }
    onProgress(progress);
  };
  log();

  const database = new sqlite3.oo1.DB(':memory:');
  try {
    await importFiles(database, zipFile, exclude, progress, log);

    log('Done, saving sqlite dump to the OPFS…');
    return sqlite3.capi.sqlite3_js_db_export(database);
  } finally {
    database.close();
  }
}
