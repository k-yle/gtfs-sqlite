import { describe, expect, it } from 'vitest';
import type { Stop } from 'gtfs-types';
import { createSqlCommands } from '../import';

describe('createSqlCommands', () => {
  it('generates the correct commands', () => {
    const fields: (keyof Stop)[] = [
      'stop_id',
      'location_type',
      'stop_lat',
      'stop_lon',
      'stop_name',
    ];
    expect(createSqlCommands(fields, 'stops')).toStrictEqual({
      create: [
        'DROP TABLE IF EXISTS stops',
        'CREATE TABLE stops(stop_id, location_type INT, stop_lat FLOAT, stop_lon FLOAT, stop_name, PRIMARY KEY (stop_id))',
      ],
      insert:
        'INSERT INTO stops(stop_id,location_type,stop_lat,stop_lon,stop_name) VALUES (?,?,?,?,?)',
    });
  });
});
