/**
 * Database access.
 *
 * Uses the built-in `node:sqlite` module rather than a compiled driver, so
 * there is no native rebuild on every Electron upgrade — historically the
 * biggest source of trouble in an Electron + SQLite app (hoofdstuk 2.5).
 *
 * Drizzle has no `node:sqlite` driver, so it is wired up through its
 * `sqlite-proxy` driver: Drizzle builds the SQL, this module executes it. That
 * keeps the query builder and the type safety without a compiled dependency.
 * See docs/BESLISSINGEN.md.
 */
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';

/**
 * De naam van het databasebestand.
 *
 * Staat hier en niet in `bootstrap.ts`, want de read-only lezer van de
 * rapportages heeft hem ook nodig en die mag de bootstrap niet importeren:
 * dat zou een invoerkring via de server opleveren.
 */
export const DATABASE_BESTANDSNAAM = 'showroom.db';

export type SqlValue = string | number | bigint | null | Uint8Array;

export type DatabaseHandle = {
  /** The raw connection, for migrations, backups and PRAGMA work. */
  raw: DatabaseSync;
  /** The Drizzle query builder. */
  db: SqliteRemoteDatabase<Record<string, never>>;
  close: () => void;
};

export type OpenOptions = {
  /** Opens the file read-only, for the SQL query tool (hoofdstuk 6.9). */
  readOnly?: boolean;
  /** How long to wait on a locked database before failing, in ms. */
  busyTimeoutMs?: number;
};

/**
 * Opens a database and applies the pragmas the app relies on.
 *
 * - `journal_mode = WAL`   readers never block the writer
 * - `foreign_keys = ON`    SQLite has these off by default
 * - `busy_timeout = 5000`  wait rather than fail on a brief lock
 * - `synchronous = NORMAL` the safe setting under WAL
 */
export function openDatabase(filename: string, options: OpenOptions = {}): DatabaseHandle {
  const raw = new DatabaseSync(filename, {
    open: true,
    readOnly: options.readOnly ?? false,
    enableForeignKeyConstraints: true,
  });

  if (!options.readOnly) {
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA synchronous = NORMAL');
  }
  raw.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
  raw.exec('PRAGMA foreign_keys = ON');

  const db = drizzle(
    async (sql, params, method) => {
      const statement = raw.prepare(sql);
      if (method === 'run') {
        statement.run(...(params as SqlValue[]));
        return { rows: [] };
      }
      // Drizzle's proxy driver expects rows as arrays of column values.
      const rows = statement.all(...(params as SqlValue[])) as Record<string, unknown>[];
      const asArrays = rows.map((row) => Object.values(row) as unknown[]);
      return { rows: method === 'get' ? (asArrays[0] ?? []) : asArrays };
    },
    // Batch support: Drizzle sends several statements, we run them in order.
    async (queries) => {
      const results: { rows: unknown[] }[] = [];
      for (const query of queries) {
        const statement = raw.prepare(query.sql);
        if (query.method === 'run') {
          statement.run(...(query.params as SqlValue[]));
          results.push({ rows: [] });
          continue;
        }
        const rows = statement.all(...(query.params as SqlValue[])) as Record<string, unknown>[];
        const asArrays = rows.map((row) => Object.values(row) as unknown[]);
        results.push({ rows: query.method === 'get' ? (asArrays[0] ?? []) : asArrays });
      }
      return results;
    },
  );

  return { raw, db, close: () => raw.close() };
}

/** Runs `fn` inside a transaction, rolling back on any error. */
export function transaction<T>(handle: DatabaseHandle, fn: () => T): T {
  handle.raw.exec('BEGIN');
  try {
    const result = fn();
    handle.raw.exec('COMMIT');
    return result;
  } catch (error) {
    handle.raw.exec('ROLLBACK');
    throw error;
  }
}

/** `PRAGMA integrity_check`, run at startup and weekly (hoofdstuk 12). */
export function integrityCheck(handle: DatabaseHandle): { ok: boolean; problems: string[] } {
  const rows = handle.raw.prepare('PRAGMA integrity_check').all() as Array<
    Record<string, unknown>
  >;
  const problems = rows
    .map((row) => String(Object.values(row)[0] ?? ''))
    .filter((value) => value !== 'ok');
  return { ok: problems.length === 0, problems };
}
