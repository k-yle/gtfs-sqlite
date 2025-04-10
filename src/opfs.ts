export async function getAllDatabaseNames() {
  const rootFolder = await navigator.storage.getDirectory();

  const output: string[] = [];
  for await (const handle of rootFolder.keys()) {
    if (handle.endsWith('.sqlite3')) {
      output.push(handle.replace(/\.sqlite3$/, ''));
    }
  }
  return output;
}

export async function deleteDatabase(databaseName: string) {
  const rootFolder = await navigator.storage.getDirectory();
  await rootFolder.removeEntry(`${databaseName}.sqlite3`);
}
