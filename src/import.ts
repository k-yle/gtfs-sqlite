import type { GtfsFile } from 'gtfs-types';
import { send } from './comms';

export namespace importDBFromZip {
  export interface Progress {
    message: string;
    perFile: Partial<Record<GtfsFile, { done: number; total: number }>>;
    warnings: Set<string>;
  }

  export type IndividualFiles = Partial<Record<GtfsFile, Blob>>;

  export interface Options {
    /**
     * either a single Blob for the zip file, or an object
     * containing {@link Blob}s for each individual file.
     */
    zipFile: File | IndividualFiles;
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
