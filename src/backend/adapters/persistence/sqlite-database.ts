import BetterSqlite3, { type Database } from 'better-sqlite3';

const STARTUP_ATTEMPTS = 50;
const STARTUP_RETRY_MS = 100;

/**
 * Opens the database file with the settings every connection needs. Foreign keys are off in SQLite unless
 * enabled per connection; WAL lets the web service and the deletion worker use the file at the same time.
 * The file must live on a local volume: file locks on network shares are not reliable.
 */
export function openDatabase(filename: string): Database {
  const database = new BetterSqlite3(filename);

  // First, so that every following statement waits for a lock held by the other process instead of failing.
  database.pragma('busy_timeout = 5000');
  // Switching the journal mode needs an exclusive lock and does not use the busy timeout, so it is retried.
  retryWhileBusy(() => database.pragma('journal_mode = WAL'));
  database.pragma('foreign_keys = ON');
  database.pragma('synchronous = FULL');
  return database;
}

/** Only used while the process starts, where blocking for a moment is acceptable. */
export function retryWhileBusy<Result>(work: () => Result, attempts = STARTUP_ATTEMPTS): Result {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return work();
    } catch (error) {
      const busy = error instanceof Error && 'code' in error && error.code === 'SQLITE_BUSY';

      if (!busy || attempt >= attempts) {
        throw error;
      }

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STARTUP_RETRY_MS);
    }
  }
}
