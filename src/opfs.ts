import { CommsChannel } from './comms';

const pool = CommsChannel(undefined);

export async function getAllDatabaseNames() {
  return pool.getDatabaseNames();
}

export async function deleteDatabase(databaseName: string) {
  return pool.deleteDatabase(databaseName);
}
