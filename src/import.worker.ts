import { type ZipEntry, unzip } from 'unzipit';
import { type ParseResult, parse as parseCsv } from 'papaparse';
import type { Database } from '@sqlite.org/sqlite-wasm';
import { DB_SCHEMA, type GtfsFile, PRIMARY_KEYS, type Table } from 'gtfs-types';
import type { importDBFromZip } from './import';

const isValidFile = (fileName: string): fileName is GtfsFile =>
  fileName in PRIMARY_KEYS;

/** @internal exported only for unit tests */
export function createSqlCommands(columns: string[], tableName: Table) {
  const fileName: GtfsFile = `${tableName}.txt`;
  const pk = PRIMARY_KEYS[fileName];
  const pkColumns = [pk]
    .flat()
    .filter((field) => field && columns.includes(field));
  const pkCmd = pkColumns.length
    ? `, PRIMARY KEY (${pkColumns.join(', ')})`
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
    insert: `INSERT INTO ${tableName}(${columns.join(',')}) SELECT ${columns.map((_, index) => `value->>${index}`).join(',')} FROM json_each(?)`,
  };
}

/**
 * Converts a {@link ReadableStream} into a fake {@link NodeJS.ReadableStream}.
 * This is a ridiculous workaround for https://github.com/mholt/PapaParse/issues/550
 */
function toNodeStream(stream: ReadableStream<string>) {
  const listeners: {
    data?(chunk: string): void;
    end?(): void;
    error?(error: unknown): void;
  } = {};

  (async () => {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (!listeners.data) {
          await reader.cancel();
          return;
        }
        if (done) break;
        listeners.data(value);
      }
      listeners.end?.();
    } catch (ex) {
      listeners.error?.(ex);
    }
  })();

  return <NodeJS.ReadableStream>(<Partial<NodeJS.ReadableStream>>{
    readable: true,
    read: () => '',
    pause() {
      return this;
    },
    resume() {
      return this;
    },
    on(event: keyof typeof listeners, callback: never) {
      listeners[event] = callback;
      return this;
    },
    removeListener(event: keyof typeof listeners) {
      delete listeners[event];
      return this;
    },
  });
}

const isEmptyRow = (row: string[]) =>
  !row.length || (row.length === 1 && !row[0]);

async function importFile(
  database: Database,
  entry: ZipEntry,
  fileName: GtfsFile,
  progress: importDBFromZip.Progress,
  log: (message?: string) => void,
) {
  const tableName = <Table>fileName.split('.')[0];
  const fileProgress = progress.perFile[fileName]!;

  log(`[${fileName}] Decompressing…`);
  const blob = await entry.blob();
  const t = performance.now();

  let insert: ReturnType<Database['prepare']> | undefined;

  const onChunk = (csv: ParseResult<string[]>) => {
    if (!insert) {
      const header = csv.data.shift()!;
      const commands = createSqlCommands(header, tableName);
      for (const command of commands.create) database.exec(command);
      insert = database.prepare(commands.insert);
    }

    const rows = csv.data.filter((row) => !isEmptyRow(row));
    for (const row of rows) {
      row[0] = row[0]!.trim(); // if files use a broken mix of \r\n, strip new lines from the first cell
    }
    insert.bind(1, JSON.stringify(rows)).stepReset();

    // progress update. We don't know the total number of rows until
    // the end, so it's estimated based on the number of characters.
    const charsRead = csv.meta.cursor;
    fileProgress.done += rows.length;
    fileProgress.total = Math.round(
      (fileProgress.done * blob.size) / charsRead,
    );
    const elapsed = performance.now() - t;
    const remaining = (elapsed * (blob.size - charsRead)) / charsRead;
    log(`[${fileName}] Importing, ${Math.round(remaining / 1000)}s remaining…`);
  };

  database.exec('BEGIN');
  try {
    await new Promise<void>((resolve, reject) => {
      const stream = blob.stream().pipeThrough(new TextDecoderStream());
      parseCsv<string[]>(toNodeStream(stream), {
        chunk: onChunk,
        complete: () => resolve(),
        error: reject,
      });
    });
    fileProgress.total = fileProgress.done;

    database.exec('COMMIT');
  } catch (ex) {
    database.exec('ROLLBACK');
    throw ex;
  } finally {
    insert?.finalize();
  }
}

/** @internal */
export async function importIntoDatabase(
  database: Database,
  { zipFile, exclude }: importDBFromZip.Options,
  onProgress: (progress: importDBFromZip.Progress) => void,
) {
  const progress: importDBFromZip.Progress = {
    message: 'unzipping…',
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
    await importFile(database, entries[fileName]!, fileName, progress, log);
  }

  log('Done');
}
