import type { importDBFromZip } from './import';
import type { PoolMethods, SqlWorker } from './sql.worker';

const broadcast = new Worker(new URL('sql.worker.js', import.meta.url), {
  type: 'module',
});

export namespace CommsChannel {
  export interface Outbound {
    /** set `databaseName` to `undefined` for {@link PoolMethods} */
    dbName?: string;
    msgId: string;
    method: keyof SqlWorker | keyof PoolMethods;
    args: unknown[];
  }

  export type Inbound =
    | { msgId: string; success: boolean; result: unknown }
    | { msgId: string; progress: importDBFromZip.Progress };
}

const callbacks: {
  [msgId: string]: {
    resolve(data: unknown): void;
    reject(error: unknown): void;
    onProgress?(progress: importDBFromZip.Progress): void;
  };
} = {};

let nextId = 0;

broadcast.addEventListener(
  'message',
  (event: MessageEvent<CommsChannel.Inbound>) => {
    const { msgId } = event.data;

    if (!callbacks[msgId]) {
      console.warn(`Discarding event with unknown msgId '${msgId}'`);
      return;
    }

    if ('progress' in event.data) {
      callbacks[msgId].onProgress?.(event.data.progress);
      // don't delete the callback, since it's re-used
      return;
    }

    // else: it's a normal message
    const { success, result } = event.data;
    callbacks[msgId][success ? 'resolve' : 'reject'](result);
    delete callbacks[msgId];
  },
);

/** @internal */
export function send(
  payload: Omit<CommsChannel.Outbound, 'msgId'>,
  onProgress?: (progress: importDBFromZip.Progress) => void,
) {
  return new Promise((resolve, reject) => {
    const messageId = `${++nextId}`;

    callbacks[messageId] = { resolve, reject, onProgress };

    broadcast.postMessage({
      ...payload,
      msgId: messageId,
    } satisfies CommsChannel.Outbound);
  });
}

/** set `databaseName` to `undefined` for {@link PoolMethods} */
export function CommsChannel(databaseName: string): SqlWorker;
/** set `databaseName` to `undefined` for {@link PoolMethods} */
export function CommsChannel(databaseName: undefined): PoolMethods;
/** set `databaseName` to `undefined` for {@link PoolMethods} */
export function CommsChannel(databaseName: string | undefined) {
  return new Proxy(<SqlWorker & PoolMethods>{}, {
    get(_, method) {
      return (...argss: unknown[]) =>
        send({
          dbName: databaseName,
          method: <never>method,
          args: argss,
        });
    },
  });
}
