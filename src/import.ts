import { setOptions, unzip } from 'unzipit';
import { type ParseResult, parse as parseCsv } from 'papaparse';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { DB_SCHEMA, type GtfsFile, PRIMARY_KEYS, type Table } from 'gtfs-types';
import packageJson from '../package.json';
import { dangerouslyUseSqlWorkerFromMainThread as SqlWorker } from './sql.worker';
import { CommsChannel } from './comms';

setOptions({
  workerURL: `https://unpkg.com/unzipit@${packageJson.dependencies.unzipit}/dist/unzipit-worker.module.js`,
});

/** emit a progress update event for every n rows */
const PROGRESS_UPDATE_INTERVAL = 10_000;

const isValidFile = (fileName: string): fileName is GtfsFile =>
  fileName in PRIMARY_KEYS;

export namespace importDBFromZip {
  export interface Progress {
    message: string;
    perFile: Partial<Record<GtfsFile, { done: number; total: number }>>;
    warnings: Set<string>;
  }
}

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

export async function importDBFromZip({
  zipFile,
  databaseName,
  onProgress,
  exclude,
}: {
  zipFile: File;
  databaseName: string;
  onProgress?(progress: importDBFromZip.Progress): void;
  exclude?: GtfsFile[];
}) {
  const progress: importDBFromZip.Progress = {
    message: 'creating in-memory sqlite database…',
    perFile: {},
    warnings: new Set(),
  };
  onProgress?.(progress);
  const log = (message?: string) => {
    if (message) {
      console.log(message);
      progress.message = message;
    }

    // shallow clone every time to ensure reactive frameworks detect the change
    onProgress?.(structuredClone(progress));
  };

  const sqlite3 = await sqlite3InitModule({
    print: console.log,
    printErr: console.error,
  });
  using comms = new SqlWorker(sqlite3, databaseName);

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
    const arrayBuffer = await entries[fileName]!.blob();

    const csv = await new Promise<ParseResult<string[]>>((resolve) => {
      parseCsv<string[]>(arrayBuffer as File, {
        worker: true,
        complete: resolve,
      });
    });

    progress.perFile[fileName]!.total = csv.data.length - 2;

    const header = csv.data.shift()!;
    const tableName = <Table>fileName.split('.')[0];

    log(`[${fileName}] Preparing table…`);
    const meta = await comms.exec(
      // not a SQL injection risk because we've validated tableName
      `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='${tableName}'`,
    );
    const exists = meta[0]!['count(*)'] !== 0;
    if (exists) {
      progress.perFile[fileName]!.done = progress.perFile[fileName]!.total;
      continue;
    }

    const commands = createSqlCommands(header, tableName);

    for (const command of commands.create) await comms.exec(command);

    const remainingSeconds: number[] = [];
    let t = performance.now();
    for (let index = 0; index < csv.data.length; index++) {
      const row = csv.data[index]!;

      if (!(!row.length || (row.length === 1 && !row[0]))) {
        row[0] = row[0]!.trim(); // if files use a broken mix of \r\n, strip new lines from the first cell
        await comms.exec(commands.insert, { bind: row });
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

          // we're intentionally blocking the main thread, so pause
          // every 1000 ops to calm down and give the browser a chance
          // to repaint, so that the user can see the latest progress.
          await window.scheduler?.yield?.();

          // fallback to setTimeout for safari
          await new Promise(
            (callback) =>
              requestIdleCallback?.(callback) ?? setTimeout(callback, 0),
          );
        }
        t = tʹ;
      }
    }
  }

  log('Done, saving sqlite dump to the OPFS…');

  // close the real DB in the OPFS, so we can overwrite the file
  await CommsChannel(databaseName).close();
  await comms.copyDBFromMemoryToOPFS();

  log('Done');
}
