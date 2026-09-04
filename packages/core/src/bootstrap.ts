/**
 * Starts the core: open the database, back it up, migrate, seed if empty, and
 * listen. Used by the Electron utility process and by `standalone.ts`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { openDatabase, integrityCheck, type DatabaseHandle } from './db/client.ts';
import { applyViews, appliedMigrations, runMigrations, schemaVersion } from './db/migrate.ts';
import { seed } from './db/seed.ts';
import { buildCore, type NetworkMode } from './server.ts';
import { checkDatabasePath } from './db/path-guard.ts';

export type BootstrapOptions = {
  /** Directory that holds the database, attachments, backups and logs. */
  dataDirectory: string;
  mode?: NetworkMode;
  /** Host mode also listens on the LAN; standalone stays on loopback. */
  port?: number;
  /** Fill an empty database with the demo scenario. */
  demo?: boolean;
  logger?: boolean;
  /** Drive letters Windows reports as network drives, for the path guard. */
  mappedDrives?: string[];
};

export type RunningCore = {
  app: FastifyInstance;
  handle: DatabaseHandle;
  port: number;
  appToken: string;
  schemaVersion: string;
  address: string;
  stop: () => Promise<void>;
};

export function dataPaths(dataDirectory: string) {
  return {
    database: join(dataDirectory, 'showroom.db'),
    attachments: join(dataDirectory, 'attachments'),
    backups: join(dataDirectory, 'backups'),
    templates: join(dataDirectory, 'templates'),
    logs: join(dataDirectory, 'logs'),
    config: join(dataDirectory, 'config.json'),
  };
}

function ensureDirectories(dataDirectory: string): void {
  const paths = dataPaths(dataDirectory);
  for (const directory of [
    dataDirectory,
    paths.attachments,
    paths.backups,
    paths.templates,
    paths.logs,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
}

/**
 * Copies the database before migrating (hoofdstuk 12). A failed migration then
 * has something to roll back to rather than leaving a half-migrated file.
 */
export function backupBeforeMigration(dataDirectory: string): string | null {
  const paths = dataPaths(dataDirectory);
  if (!existsSync(paths.database)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const target = join(paths.backups, `showroom-voor-migratie-${stamp}.db`);
  copyFileSync(paths.database, target);
  return target;
}

/** Keeps the newest `keep` backups matching a prefix and deletes the rest. */
export function pruneBackups(backupDirectory: string, prefix: string, keep: number): number {
  if (!existsSync(backupDirectory)) return 0;
  const files = readdirSync(backupDirectory)
    .filter((file) => file.startsWith(prefix) && file.endsWith('.db'))
    .map((file) => ({ file, at: statSync(join(backupDirectory, file)).mtimeMs }))
    .sort((a, b) => b.at - a.at);

  let removed = 0;
  for (const entry of files.slice(keep)) {
    unlinkSync(join(backupDirectory, entry.file));
    removed += 1;
  }
  return removed;
}

export async function startCore(options: BootstrapOptions): Promise<RunningCore> {
  const mode = options.mode ?? 'standalone';

  // Weigeren gaat vóór aanmaken: een database op een netwerkschijf of in een
  // synchronisatiemap raakt beschadigd (hoofdstuk 2.3).
  const verdict = checkDatabasePath(options.dataDirectory, options.mappedDrives ?? []);
  if (!verdict.ok) {
    throw new Error(verdict.message);
  }

  ensureDirectories(options.dataDirectory);
  const paths = dataPaths(options.dataDirectory);
  const isNew = !existsSync(paths.database);

  if (!isNew) backupBeforeMigration(options.dataDirectory);

  const handle = openDatabase(paths.database);

  const integrity = integrityCheck(handle);
  if (!integrity.ok) {
    handle.close();
    throw new Error(
      `De database is beschadigd: ${integrity.problems.slice(0, 3).join('; ')}. ` +
        'Herstel een back-up via Instellingen > Back-up & herstel.',
    );
  }

  runMigrations(handle);
  applyViews(handle);

  if (appliedMigrations(handle).length > 0) {
    const users = handle.raw.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    if (Number(users.n) === 0) await seed(handle, { demo: options.demo });
  }

  const appToken = randomBytes(32).toString('base64url');
  const app = await buildCore({
    handle,
    appToken,
    mode,
    dataDirectory: options.dataDirectory,
    logger: options.logger ?? false,
  });

  // Alleenstaand luistert alleen op loopback; hostmodus ook op het LAN.
  const host = mode === 'host' ? '0.0.0.0' : '127.0.0.1';
  const requestedPort = options.port ?? (mode === 'host' ? 4317 : 0);
  await app.listen({ host, port: requestedPort });

  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : requestedPort;

  return {
    app,
    handle,
    port,
    appToken,
    schemaVersion: schemaVersion(handle),
    address: `http://${mode === 'host' ? '0.0.0.0' : '127.0.0.1'}:${port}`,
    stop: async () => {
      await app.close();
      handle.close();
    },
  };
}
