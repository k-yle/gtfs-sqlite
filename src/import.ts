import type { GtfsFile } from 'gtfs-types';
import { send } from './comms';

export namespace importDBFromZip {
  export interface Progress {
    message: string;
    perFile: Partial<Record<GtfsFile, { done: number; total: number }>>;
    warnings: Set<string>;
  }

  export interface Options {
    zipFile: File;
    databaseName: string;
    exclude?: GtfsFile[];
  }
}

/** imports a GTFS zip file into the OPFS. Runs in a web worker */
export async function importDBFromZip({
  onProgress,
  ...options
}: importDBFromZip.Options & {
  onProgress?(progress: importDBFromZip.Progress): void;
}) {
  await send({ method: 'importDBFromZip', args: [options] }, onProgress);
}
