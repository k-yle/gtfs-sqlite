import sqlite3InitModule, {
  type Database,
  type ExecBaseOptions,
  type SqlValue,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import type { GtfsFiles, Table } from 'gtfs-types';
import { importIntoDatabase } from './import.worker';
import type { PoolMethods, SqlWorker } from './sql.worker';
import type * as real from './index';

// This is a separate entrypoint ('gtfs-sqlite/e2e') for use in unit tests
// or any NodeJS environment. See README.

const toFileName = (databaseName: string) => `/${databaseName}.sqlite3`;

async function createBackend() {
  const sqlite3 = await sqlite3InitModule({
    print: console.log,
    printErr: console.error,
  });
  const vfsUnlink = sqlite3.wasm.xWrap('sqlite3__wasm_vfs_unlink', 'int', [
    'sqlite3_vfs*',
    'string',
  ]);

  const fileNames = new Set<string>();

  return {
    sqlite3,
    fileNames,
    open(fileName: string) {
      fileNames.add(fileName);
      return new sqlite3.oo1.DB(fileName, 'c');
    },
    unlink(fileName: string) {
      if (!fileNames.delete(fileName)) return false;
      vfsUnlink(sqlite3.capi.sqlite3_vfs_find(null), fileName);
      return true;
    },
  };
}

let cache: ReturnType<typeof createBackend> | undefined;
function init() {
  cache ||= createBackend();
  return cache;
}

/** should have an identical API to {@link SqlWorker} */
class InMemorySqlWorker implements Pick<SqlWorker, keyof SqlWorker> {
  #sqlite3: Sqlite3Static;

  #db: Database;

  constructor(
    backend: Awaited<ReturnType<typeof createBackend>>,
    databaseName: string,
  ) {
    this.#sqlite3 = backend.sqlite3;
    this.#db = backend.open(toFileName(databaseName));
  }

  async getVersion() {
    return this.#sqlite3.version.libVersion;
  }

  async exec<T extends object = { [columnName: string]: SqlValue }>(
    sql: string,
    options?: ExecBaseOptions,
  ) {
    try {
      const resultRows: { [columnName: string]: SqlValue }[] = [];
      this.#db.exec(sql, {
        ...options,
        resultRows,
        rowMode: 'object',
      });
      return resultRows as T[];
    } catch (ex) {
      if (ex instanceof Error) ex.cause = sql;
      throw ex;
    }
  }

  async close() {
    this.#db.close();
  }

  [Symbol.dispose] = this.close;

  async getColumns<T extends Table>(tableName: T) {
    const result = await this.exec<{ name: string }>(
      `PRAGMA table_info(${tableName});`,
    );
    return new Set(
      result.map((col) => col.name as keyof GtfsFiles[`${T}.txt`]),
    );
  }

  async dump() {
    const uint8 = this.#sqlite3.capi.sqlite3_js_db_export(this.#db);
    const blob = new Blob([<ArrayBuffer>uint8.buffer], {
      type: 'application/x-sqlite3',
    });
    return URL.createObjectURL(blob);
  }
}

const databases: { [dbName: string]: InMemorySqlWorker } = {};

async function closeDatabase(databaseName: string) {
  await databases[databaseName]?.close();
  delete databases[databaseName];
}

/** equivalent to {@link PoolMethods}, but in-memory */
const poolMethods: Pick<PoolMethods, keyof PoolMethods> = {
  async getDatabaseNames() {
    const { fileNames } = await init();
    return [...fileNames].map((fileName) =>
      fileName.slice(1).replace(/\.sqlite3$/, ''),
    );
  },

  async importDBFromZip(options, onProgress) {
    const backend = await init();
    const fileName = toFileName(options.databaseName);

    await closeDatabase(options.databaseName); // so that we can overwrite it
    backend.unlink(fileName);
    const database = backend.open(fileName);
    try {
      await importIntoDatabase(database, options, onProgress);
      database.close();
    } catch (ex) {
      database.close();
      backend.unlink(fileName);
      throw ex;
    }
  },

  async deleteDatabase(databaseName) {
    const backend = await init();
    await closeDatabase(databaseName);
    const deleted = backend.unlink(toFileName(databaseName));
    if (!deleted) {
      throw new ReferenceError(`Database "${databaseName}" does not exist`);
    }
  },
};

/** equivalent to the WebWorker's message handler */
async function send(
  databaseName: string | undefined,
  method: string,
  ārgs: unknown[],
  onProgress?: (progress: real.importDBFromZip.Progress) => void,
) {
  try {
    let result: unknown;
    if (databaseName === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe since we have typesafety
      result = await (<any>poolMethods[<keyof PoolMethods>method])(
        ...ārgs,
        onProgress,
      );
    } else {
      databases[databaseName] ||= new InMemorySqlWorker(
        await init(),
        databaseName,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe since we have typesafety
      result = await (<any>databases[databaseName][<keyof SqlWorker>method])(
        ...ārgs,
      );

      // extra step required
      if (method === 'close') delete databases[databaseName];
    }
    return structuredClone(result);
  } catch (error) {
    throw structuredClone(error);
  }
}

//
// everything below this line has the same API as the main entrypoint
//

export const CommsChannel: typeof real.CommsChannel = (
  databaseName: string | undefined,
) =>
  new Proxy(<never>{}, {
    get(_, method) {
      return (...parameters: unknown[]) =>
        send(databaseName, <string>method, parameters);
    },
  });

export async function importDBFromZip({
  onProgress,
  ...options
}: Parameters<typeof real.importDBFromZip>[0]) {
  await send(undefined, 'importDBFromZip', [options], (progress) =>
    onProgress?.(structuredClone(progress)),
  );
}

export async function getAllDatabaseNames() {
  return CommsChannel(undefined).getDatabaseNames();
}

export async function deleteDatabase(databaseName: string) {
  return CommsChannel(undefined).deleteDatabase(databaseName);
}
