import type { SqlWorker } from './sql.worker';
// since we're externalising sqlite-wasm, and there are
// no other deps, the actual size of our worker is extremely small.
// TODO: so we could easily inline it.
const broadcast = new Worker(new URL('sql.worker.ts', import.meta.url), {
  type: 'module',
});

export namespace CommsChannel {
  export interface Outbound {
    dbName: string;
    msgId: string;
    method: keyof SqlWorker;
    args: unknown[];
  }

  export interface Inbound {
    msgId: string;
    success: boolean;
    result: unknown;
  }
}

const callbacks: {
  [msgId: string]: {
    resolve(data: unknown): void;
    reject(error: unknown): void;
  };
} = {};

let nextId = 0;

broadcast.addEventListener(
  'message',
  (event: MessageEvent<CommsChannel.Inbound>) => {
    const { msgId, success, result } = event.data;

    if (!callbacks[msgId]) {
      console.warn(`Discarding event with unknown msgId '${msgId}'`);
      return;
    }

    callbacks[msgId][success ? 'resolve' : 'reject'](result);
  },
);

export function CommsChannel(databaseName: string) {
  return new Proxy(<SqlWorker>{}, {
    get(_, method) {
      return (...argss: unknown[]) => {
        return new Promise((resolve, reject) => {
          const messageId = `${++nextId}`;

          callbacks[messageId] = { resolve, reject };

          broadcast.postMessage({
            dbName: databaseName,
            msgId: messageId,
            method: method as keyof SqlWorker,
            args: argss,
          } satisfies CommsChannel.Outbound);
        });
      };
    },
  });
}
