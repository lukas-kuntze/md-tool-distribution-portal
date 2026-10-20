import { describe, expect, it } from 'vitest';

import { openDatabase, retryWhileBusy } from './sqlite-database.js';

const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });

describe('openDatabase', (): void => {
  it('enables foreign keys and a busy timeout on every connection', (): void => {
    const database = openDatabase(':memory:');

    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.pragma('busy_timeout', { simple: true })).toBe(5000);
    database.close();
  });
});

describe('retryWhileBusy', (): void => {
  it('retries while the database is locked by another process', (): void => {
    let calls = 0;

    expect(
      retryWhileBusy(() => {
        calls += 1;

        if (calls < 3) {
          throw busy;
        }

        return 'wal';
      }),
    ).toBe('wal');
    expect(calls).toBe(3);
  });

  it('gives up after the last attempt and never retries other errors', (): void => {
    const other = new Error('disk I/O error');

    expect(() =>
      retryWhileBusy(() => {
        throw busy;
      }, 2),
    ).toThrow(busy);
    expect(() =>
      retryWhileBusy(() => {
        throw other;
      }),
    ).toThrow(other);
  });
});
