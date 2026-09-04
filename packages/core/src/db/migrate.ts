/**
 * Migration runner.
 *
 * Migrations are plain, committed .sql files applied in filename order and
 * recorded in `schema_migrations`. No ORM generates or reorders them, so what
 * runs in production is exactly what is in the repository (hoofdstuk 0).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseHandle } from './client.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export type AppliedMigration = { name: string; appliedAt: string };

function ensureMigrationsTable(handle: DatabaseHandle): void {
  handle.raw.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function appliedMigrations(handle: DatabaseHandle): AppliedMigration[] {
  ensureMigrationsTable(handle);
  const rows = handle.raw
    .prepare('SELECT name, applied_at FROM schema_migrations ORDER BY name')
    .all() as Array<{ name: string; applied_at: string }>;
  return rows.map((row) => ({ name: row.name, appliedAt: row.applied_at }));
}

/** Migration files on disk, in the order they must be applied. */
export function migrationFiles(directory = MIGRATIONS_DIR): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * Applies every migration that has not run yet.
 *
 * Each migration runs in its own transaction: a failing migration leaves the
 * database on the last version that did apply, rather than half-migrated.
 */
export function runMigrations(
  handle: DatabaseHandle,
  directory = MIGRATIONS_DIR,
): { applied: string[]; alreadyCurrent: boolean } {
  ensureMigrationsTable(handle);

  const done = new Set(appliedMigrations(handle).map((migration) => migration.name));
  const pending = migrationFiles(directory).filter((file) => !done.has(basename(file)));
  const applied: string[] = [];

  for (const file of pending) {
    const sql = readFileSync(join(directory, file), 'utf8');
    handle.raw.exec('BEGIN');
    try {
      handle.raw.exec(sql);
      handle.raw
        .prepare('INSERT INTO schema_migrations (name) VALUES (?)')
        .run(basename(file));
      handle.raw.exec('COMMIT');
      applied.push(basename(file));
    } catch (error) {
      handle.raw.exec('ROLLBACK');
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Migratie "${file}" is mislukt en is teruggedraaid: ${reason}`);
    }
  }

  return { applied, alreadyCurrent: applied.length === 0 };
}

/** The schema version a host and its clients must agree on (hoofdstuk 12). */
export function schemaVersion(handle: DatabaseHandle): string {
  const migrations = appliedMigrations(handle);
  return migrations.at(-1)?.name ?? '0000_leeg';
}

const VIEWS_FILE = join(dirname(fileURLToPath(import.meta.url)), 'views.sql');

/**
 * (Re)creates the reporting views. Views hold no data, so they are simply
 * dropped and recreated on every start; that keeps them in step with the code
 * without needing a migration for every reporting tweak.
 */
export function applyViews(handle: DatabaseHandle, file = VIEWS_FILE): void {
  handle.raw.exec(readFileSync(file, 'utf8'));
}
