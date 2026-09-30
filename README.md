# gtfs-sqlite

[![Build Status](https://github.com/k-yle/gtfs-sqlite/workflows/Build%20and%20Test/badge.svg)](https://github.com/k-yle/gtfs-sqlite/actions)
[![npm version](https://badge.fury.io/js/gtfs-sqlite.svg)](https://badge.fury.io/js/gtfs-sqlite)
[![npm](https://img.shields.io/npm/dt/gtfs-sqlite.svg)](https://www.npmjs.com/package/gtfs-sqlite)
![npm bundle size](https://img.shields.io/bundlephobia/minzip/gtfs-sqlite)

🚌🚇 A TS/JS library to import a GTFS file into a sqlite database, completely in the browser.

Try [the demo here](https://kyle.kiwi/gtfs-sqlite).

# How it works

The sqlite database is stored in the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), and accessed via [sqlite-wasm](https://github.com/sqlite/sqlite-wasm) running in a [WebWorker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) thread.

There means there is a slight overhead for each sql command, but it allows you to execute complex and expensive queries without blocking the main thread.

![](https://github.com/user-attachments/assets/bdf49655-66cd-4ddb-a87b-320b83d36acc)

<!--
github can't natively render this some mermaid diagrams 🥲
source code:

```mermaid
zenuml
    title gtfs-sqlite
    @Actor User
    MainThread #fee
    WebWorker #fee
    @Database <<DB>> InMemory #aee
    @Database <<DB>> OPFS #aee

    @Starter(User)
    // Case 1
    MainThread.importDBFromZip(zipFile) {
        WebWorker.importDBFromZip(zipFile) {
            csvFiles = unzip(zipFile);
            forEach(csvFile) {
                rows = parseCsv(csvFile);
                InMemory.insert(rows);
                WebWorker->MainThread: onProgress
            }
            sqliteDump = InMemory.export();
            OPFS.importDb(sqliteDump);
        }
    }

    // Case 2
    result = MainThread.queryDatabase(query) {
        result = WebWorker.exec(query) {
            result = OPFS.exec(query);
        }
    }
```
--->

# Install

```sh
npm install gtfs-sqlite
```

You will need to use a bundler like vite that supports WebWorkers.

You'll also need to add this logic to your `vite.config.js` file (or equivilant file for other bundlers):

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm', 'gtfs-sqlite'],
    include: ['gtfs-sqlite > papaparse'],
  },
});
```

# Usage

```ts
import {
  getAllDatabaseNames,
  importDBFromZip,
  CommsChannel,
} from 'gtfs-sqlite';

// returns a list of gtfs databases that are already stored in the browser's OPFS
await getAllDatabaseNames();

// imports a new database into the browser's OPFS storage
await importDBFromZip({
  zipFile: file, // a File or Blob object that a user uploaded
  databaseName: 'exampleDatabaseForMyCity',
  onProgress: console.log,
  exclude: ['shapes.txt'], // any files to be ignored (to save time & space)
});

// this is the main API for querying the database, it
// forwards all requests to a WebWorker.
const db = CommsChannel('exampleDatabaseForMyCity');

// for example:
await db.exec('SELECT * FROM routes');
await db.getColumns('routes'); // to check if some optional columns exist for this city
await db.dump(); // if you want to export the db to a .sqlite3 file
```

# TypeScript

This library is type-safe thanks to [gtfs-types](https://npm.im/gtfs-types). That package also defines whether columns should be imported as a `string`, `float`, or `int`, and provides enums to make queries more readable.

Example usage with TypeScript:

```ts
import { Route, Agency, VehicleType } from 'gtfs-types';

const rows = await db.exec<Route & Agency>(
  `
    SELECT * FROM routes r
    WHERE r.route_type='${VehicleType.BUS}'
    INNER JOIN agency a ON r.agency_id = a.agency_id
  `,
);
```
