import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type * as testingEntrypoint from '../e2e';
import { importDBFromZip } from '../e2e';
import { CommsChannel, deleteDatabase, getAllDatabaseNames } from '../index';
import type * as mainEntrypoint from '../index';

// this is what consumers of gtfs-sqlite do
vi.mock('../index', () => vi.importActual('../e2e'));

const files = {
  'stops.txt': new Blob([
    'stop_id,stop_name,stop_lat,stop_lon,location_type\n1,"Main St, North",-41.1,174.1,0\n2,Station,-41.2,174.2,\n',
  ]),
  'routes.txt': new Blob(['route_id,route_short_name,route_type\nR1,1,3\n']),
};

describe('e2e entrypoint', () => {
  it('imports unzipped files into an in-memory database', async () => {
    expectTypeOf<typeof testingEntrypoint>().toMatchTypeOf<
      Omit<typeof mainEntrypoint, 'send'>
    >();

    const onProgress = vi.fn<never>();
    await importDBFromZip({ databaseName: 'test', zipFile: files, onProgress });

    expect(onProgress).toHaveBeenLastCalledWith({
      message: 'Done',
      perFile: {
        'stops.txt': { done: 2, total: 2 },
        'routes.txt': { done: 1, total: 1 },
      },
      warnings: new Set(),
    });
    expect(await getAllDatabaseNames()).toStrictEqual(['test']);

    const comms = CommsChannel('test');
    expect(await comms.getVersion()).toMatch(/^3\./);
    expect(await comms.getColumns('stops')).toStrictEqual(
      new Set([
        'stop_id',
        'stop_name',
        'stop_lat',
        'stop_lon',
        'location_type',
      ]),
    );
    expect(
      await comms.exec("SELECT * FROM stops WHERE location_type IN (0, '')"),
    ).toStrictEqual([
      {
        stop_id: '1',
        stop_name: 'Main St, North',
        stop_lat: -41.1,
        stop_lon: 174.1,
        location_type: 0,
      },
      {
        stop_id: '2',
        stop_name: 'Station',
        stop_lat: -41.2,
        stop_lon: 174.2,
        location_type: '',
      },
    ]);

    // test closing/reopening the connection
    await comms.close();
    expect(await comms.exec('SELECT count(*) n FROM routes')).toStrictEqual([
      { n: 1 },
    ]);

    await expect(comms.exec('SELECT * FROM nonexistant')).rejects.toThrow(
      'no such table: nonexistant',
    );

    // re-import, and overwrite the existing database
    await importDBFromZip({
      databaseName: 'test',
      zipFile: { 'routes.txt': files['routes.txt'] },
    });
    expect(await comms.exec('SELECT count(*) n FROM routes')).toStrictEqual([
      { n: 1 },
    ]);
    await expect(comms.exec('SELECT * FROM stops')).rejects.toThrow(
      'no such table: stops',
    );

    await comms.close();
    await deleteDatabase('test');
    expect(await getAllDatabaseNames()).toStrictEqual([]);
    await expect(deleteDatabase('test')).rejects.toThrow(
      'Database "test" does not exist',
    );
  });
});
