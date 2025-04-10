import sqlite3InitModule, {
  type Database,
  type ExecBaseOptions,
  type SqlValue,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import type { GtfsFiles, Table } from 'gtfs-types';
import type { CommsChannel } from './comms';

class SqlWorker {
  #sqlite3: Sqlite3Static;

  #db: Database;

  #isInOPFS: boolean;

  constructor(sqlite3: Sqlite3Static, databaseName: string) {
    const file = `/${databaseName}.sqlite3`;
    this.#isInOPFS = 'opfs' in sqlite3;
    this.#sqlite3 = sqlite3;
    this.#db = this.#isInOPFS
      ? new sqlite3.oo1.OpfsDb(file)
      : new sqlite3.oo1.DB(file, 'c');
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

  /**
   * @internal
   * serialises {@link this.#db} to a {@link Uint8Array}, then saves it into
   * the OPFS where it can be re-opened by a different instance of this
   * class running in a WebWorker.
   */
  async copyDBFromMemoryToOPFS() {
    if (this.#isInOPFS) throw new Error('This DB is already in the OPFS');

    const uint8 = this.#sqlite3.capi.sqlite3_js_db_export(this.#db);
    const blob = new Blob([uint8.buffer], { type: 'application/x-sqlite3' });

    const rootFolder = await navigator.storage.getDirectory();
    const fileHandle = await rootFolder.getFileHandle(
      this.#db.filename.slice(1), // removing leading slash
      { create: true },
    );
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }
}
const sqlite3Promise = sqlite3InitModule({
  print: console.log,
  printErr: console.error,
});

const databases: { [dbName: string]: SqlWorker } = {};

const isPayloadValid = (data: unknown): data is CommsChannel.Outbound =>
  typeof data === 'object' && !!data && 'dbName' in data;

const onMessage = async (message: MessageEvent) => {
  if (!isPayloadValid(message.data)) return;

  const { dbName, msgId, method, args } = message.data;

  try {
    const sqlite3 = await sqlite3Promise;
    databases[dbName] ||= new SqlWorker(sqlite3, dbName);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- safe since we have typesafety
    const result = await (<any>databases[dbName][method])(...args);

    // extra step required
    if (method === 'close') delete databases[dbName];

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
// be imported at runtime from the main thread, except for
// controlled cases where the performance gain necessitates it.
export type { SqlWorker };
export { SqlWorker as dangerouslyUseSqlWorkerFromMainThread };
