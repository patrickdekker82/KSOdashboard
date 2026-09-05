/**
 * Starts the core: open the database, back it up, migrate, seed if empty, and
 * listen. Used by the Electron utility process and by `standalone.ts`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  DATABASE_BESTANDSNAAM,
  openDatabase,
  integrityCheck,
  type DatabaseHandle,
} from './db/client.ts';
import { applyViews, appliedMigrations, runMigrations, schemaVersion } from './db/migrate.ts';
import { seed } from './db/seed.ts';
import { buildCore, type NetworkMode } from './server.ts';
import { checkDatabasePath } from './db/path-guard.ts';
import { voerControleUit } from './modules/alerts/engine.ts';
import { vervalVerlopenOffertes } from './modules/packages/quotes.ts';
import { maakBackup } from './modules/backup/backup.ts';

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
    database: join(dataDirectory, DATABASE_BESTANDSNAAM),
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

  const stopControle = startSignaleringen(handle, options.logger ?? false);
  const stopBackup = startNachtelijkeBackup(handle, options.dataDirectory, options.logger ?? false);

  return {
    app,
    handle,
    port,
    appToken,
    schemaVersion: schemaVersion(handle),
    address: `http://${mode === 'host' ? '0.0.0.0' : '127.0.0.1'}:${port}`,
    stop: async () => {
      stopControle();
      stopBackup();
      await app.close();
      handle.close();
    },
  };
}

/**
 * Hoe vaak er gekeken wordt of de nachtelijke back-up aan de beurt is.
 *
 * Elke tien minuten kijken en zelf bepalen of het tijd is, in plaats van één
 * timer op het juiste moment zetten. Een laptop die 's nachts dicht staat
 * slaapt door een `setTimeout` van acht uur heen; deze aanpak pakt de back-up
 * alsnog op zodra de machine weer aan gaat.
 */
const BACKUP_TIK_MS = 10 * 60 * 1000;

/**
 * Draait de nachtelijke back-up.
 *
 * De tijd en het bewaarbeleid komen uit de instelling `backup`. Er wordt
 * hooguit één automatische back-up per dag gemaakt: dat is te zien aan het
 * logboek, niet aan een variabele in het geheugen, zodat een herstart van de
 * applicatie er geen tweede oplevert.
 */
function startNachtelijkeBackup(
  handle: DatabaseHandle,
  dataDirectory: string,
  logger: boolean,
): () => void {
  const paths = dataPaths(dataDirectory);

  const draai = (): void => {
    try {
      const rij = handle.raw
        .prepare("SELECT value FROM settings WHERE key = 'backup'")
        .get() as { value: string } | undefined;

      let opties: Record<string, unknown> = {};
      try {
        opties = JSON.parse(rij?.value ?? '{}') as Record<string, unknown>;
      } catch {
        opties = {};
      }

      if (opties.automatisch === false) return;

      const tijd = typeof opties.tijd === 'string' ? opties.tijd : '23:00';
      const nu = new Date();
      const vandaag = nu.toISOString().slice(0, 10);
      const [uur, minuut] = tijd.split(':').map(Number);
      const gepland = new Date(nu);
      gepland.setHours(uur ?? 23, minuut ?? 0, 0, 0);

      if (nu < gepland) return;

      const alGedraaid = handle.raw
        .prepare(
          `SELECT 1 AS er FROM backup_runs
            WHERE soort = 'automatisch' AND date(created_at) = ? AND status = 'ok'
            LIMIT 1`,
        )
        .get(vandaag);
      if (alGedraaid !== undefined) return;

      const doelmap = typeof opties.doelmap === 'string' && opties.doelmap !== '' ? opties.doelmap : undefined;
      const bewaar = Number(opties.bewaar_dagelijks ?? 30);

      const uitkomst = maakBackup(handle, paths.database, paths.backups, {
        soort: 'automatisch',
        doelmap,
        bewaar: Number.isFinite(bewaar) ? bewaar : 30,
        gebruikerId: null,
        nu,
      });

      if (logger) {
        process.stdout.write(
          `Back-up: ${uitkomst.bestandsnaam} (${Math.round(uitkomst.bytes / 1024)} kB, ${uitkomst.opgeruimd} opgeruimd)\n`,
        );
      }
    } catch (error) {
      // De mislukking staat al in `backup_runs` en gaat vanzelf als
      // signalering het dashboard op. Hier alleen niet omvallen.
      if (logger) {
        process.stderr.write(
          `Back-up mislukt: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  };

  // Niet meteen bij het starten: dan krijgt iemand die de applicatie 's avonds
  // even opnieuw opstart een tweede back-up over zich heen.
  const herhaling = setInterval(draai, BACKUP_TIK_MS);
  herhaling.unref?.();

  return () => clearInterval(herhaling);
}

/** Hoe vaak de signaleringen worden doorgerekend. */
const CONTROLE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Zet de uurlijkse controle op de signaleringen aan.
 *
 * Er draait bewust geen cron-bibliotheek en er wordt niets van `check_cron`
 * gelezen: één vast uur is genoeg voor meldingen die over weken en dagen gaan,
 * en een tweede planningsmechanisme naast de timer levert alleen maar vragen op
 * over welk van de twee nu leidend is.
 *
 * De eerste ronde draait kort na het starten en niet meteen: dan is het venster
 * er al en wacht de gebruiker niet op een berekening over zesentwintig weken.
 * De timer krijgt `unref()`, zodat een afsluitend proces er niet op blijft
 * wachten.
 */
function startSignaleringen(handle: DatabaseHandle, logger: boolean): () => void {
  const draai = (): void => {
    try {
      // Eerst opruimen, dan signaleren: een offerte die vandaag verloopt hoort
      // niet eerst als "wacht op antwoord" gemeld te worden en daarna pas te
      // vervallen.
      const vervallen = vervalVerlopenOffertes(handle);
      if (logger && vervallen > 0) {
        process.stdout.write(`Offertes vervallen: ${vervallen}\n`);
      }

      const uitkomst = voerControleUit(handle);
      if (logger && (uitkomst.nieuw > 0 || uitkomst.opgelost > 0)) {
        process.stdout.write(
          `Signaleringen: ${uitkomst.nieuw} nieuw, ${uitkomst.opgelost} opgelost\n`,
        );
      }
    } catch (error) {
      // Een mislukte controle mag de kern nooit onderuit halen: de volgende
      // ronde is over een uur, en de rest van de applicatie werkt gewoon door.
      if (logger) {
        process.stderr.write(
          `Signaleringen mislukt: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  };

  const eerste = setTimeout(draai, 5_000);
  const herhaling = setInterval(draai, CONTROLE_INTERVAL_MS);
  eerste.unref?.();
  herhaling.unref?.();

  return () => {
    clearTimeout(eerste);
    clearInterval(herhaling);
  };
}
