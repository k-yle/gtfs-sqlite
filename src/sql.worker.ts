import sqlite3InitModule, {
  type Database,
  type ExecBaseOptions,
  type SqlValue,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import type { GtfsFiles, Table } from 'gtfs-types';
import type { CommsChannel } from './comms';
import type { importDBFromZip } from './import';
import { importIntoMemory } from './import.worker';

type SAHPool = Awaited<ReturnType<Sqlite3Static['installOpfsSAHPoolVfs']>>;

class SqlWorker {
  #sqlite3: Sqlite3Static;

  #db: Database;

  constructor(sqlite3: Sqlite3Static, databaseName: string, pool: SAHPool) {
    this.#sqlite3 = sqlite3;
    this.#db = new pool.OpfsSAHPoolDb(`/${databaseName}.sqlite3`);
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
      `PRAGMA table_info(${tableName});`, // no SQL injection risk if you use TS
    );
    return new Set(
      result.map((col) => col.name as keyof GtfsFiles[`${T}.txt`]),
    );
  }

  async dump() {
    const uint8 = this.#sqlite3.capi.sqlite3_js_db_export(this.#db);
    const blob = new Blob([uint8.buffer], { type: 'application/x-sqlite3' });
    return URL.createObjectURL(blob);
  }
}

let cache: Promise<{ sqlite3: Sqlite3Static; pool: SAHPool }>;
function init() {
  cache ||= (async () => {
    const sqlite3 = await sqlite3InitModule({
      print: console.log,
      printErr: console.error,
    });
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'gtfs-sqlite' });
    return { sqlite3, pool };
  })();
  return cache;
}

const databases: { [dbName: string]: SqlWorker } = {};

async function closeDatabase(databaseName: string) {
  await databases[databaseName]?.close();
  delete databases[databaseName];
}

const poolMethods = {
  async getDatabaseNames() {
    const { pool } = await init();
    return pool
      .getFileNames()
      .filter((fileName) => fileName.endsWith('.sqlite3'))
      .map((fileName) => fileName.slice(1).replace(/\.sqlite3$/, ''));
  },

  async importDBFromZip(
    options: importDBFromZip.Options,
    onProgress: (progress: importDBFromZip.Progress) => void,
  ) {
    const { sqlite3, pool } = await init();
    const data = await importIntoMemory(sqlite3, options, onProgress);

    await closeDatabase(options.databaseName); // so that we can overwrite it
    await pool.reserveMinimumCapacity(pool.getFileCount() + 3);
    await pool.importDb(`/${options.databaseName}.sqlite3`, data);
  },

  async deleteDatabase(databaseName: string) {
    const { pool } = await init();
    await closeDatabase(databaseName);
    const deleted = pool.unlink(`/${databaseName}.sqlite3`);
    if (!deleted) {
      throw new ReferenceError(`Database "${databaseName}" does not exist`);
    }
  },
};

const isPayloadValid = (data: unknown): data is CommsChannel.Outbound =>
  typeof data === 'object' && !!data && 'msgId' in data;

const onMessage = async (message: MessageEvent) => {
  if (!isPayloadValid(message.data)) return;

  const { dbName, msgId, method, args } = message.data;

  const onProgress = (progress: importDBFromZip.Progress) =>
    postMessage({ msgId, progress } satisfies CommsChannel.Inbound);

  try {
    let result: unknown;
    if (dbName === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe since we have typesafety
      result = await (<any>poolMethods[<keyof PoolMethods>method])(
        ...args,
        onProgress,
      );
    } else {
      const { sqlite3, pool } = await init();
      if (!databases[dbName]) {
        await pool.reserveMinimumCapacity(pool.getFileCount() + 3);
      }
      databases[dbName] ||= new SqlWorker(sqlite3, dbName, pool);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe since we have typesafety
      result = await (<any>databases[dbName][<keyof SqlWorker>method])(...args);

      // extra step required
      if (method === 'close') delete databases[dbName];
    }

    postMessage({
      msgId,
      success: true,
      result,
    } satisfies CommsChannel.Inbound);
  } catch (error) {
    // the stack trace will likely get lost when passed between JS realms,
    // so we print the error directly from the worker thread too.
    console.error(`[${msgId}]`, error);
    postMessage({
      msgId,
      success: false,
      result: error,
    } satisfies CommsChannel.Inbound);
  }
};

if (typeof WorkerGlobalScope !== 'undefined') onmessage = onMessage;

// important! only export types, nothing from this file should
// be imported at runtime from the main thread.
export type { SqlWorker };
export type PoolMethods = typeof poolMethods;
