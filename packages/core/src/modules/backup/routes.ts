/** Endpoints voor back-up en herstel (hoofdstuk 12). */
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DATABASE_BESTANDSNAAM } from '../../db/client.ts';
import { ApiError, requireRole } from '../../server.ts';
import { checkDatabasePath } from '../../db/path-guard.ts';
import {
  BackupFout,
  controleerBruikbaar,
  laatsteStand,
  lijstBackups,
  logboek,
  maakBackup,
} from './backup.ts';

type Rij = Record<string, unknown>;

function databasepad(request: FastifyRequest): string {
  return join(request.core.dataDirectory, DATABASE_BESTANDSNAAM);
}

function backupmap(request: FastifyRequest): string {
  return join(request.core.dataDirectory, 'backups');
}

/** De instelling `backup` uit de settings-tabel, met terugvallen. */
function instellingen(request: FastifyRequest): {
  tijd: string;
  bewaarDagelijks: number;
  bewaarMaandelijks: number;
  doelmap: string | null;
} {
  const rij = request.core.handle.raw
    .prepare("SELECT value FROM settings WHERE key = 'backup'")
    .get() as { value: string } | undefined;

  let waarde: Rij = {};
  try {
    waarde = JSON.parse(rij?.value ?? '{}') as Rij;
  } catch {
    waarde = {};
  }

  return {
    tijd: typeof waarde.tijd === 'string' ? waarde.tijd : '23:00',
    bewaarDagelijks: Number(waarde.bewaar_dagelijks ?? 30),
    bewaarMaandelijks: Number(waarde.bewaar_maandelijks ?? 12),
    doelmap: typeof waarde.doelmap === 'string' && waarde.doelmap !== '' ? waarde.doelmap : null,
  };
}

function vang<T>(fn: () => T): T {
  try {
    return fn();
  } catch (fout) {
    if (fout instanceof BackupFout) {
      throw new ApiError(fout.code === 'niet_gevonden' ? 404 : 400, fout.code, fout.message);
    }
    throw fout;
  }
}

export async function registerBackupRoutes(app: FastifyInstance): Promise<void> {
  /** Wat er staat, wanneer het voor het laatst lukte, en wat de instellingen zijn. */
  app.get('/api/v1/backups', async (request) => {
    requireRole(request, 'admin');
    const opties = instellingen(request);

    return {
      data: {
        backups: lijstBackups(backupmap(request)),
        // Een back-up naar een netwerkschijf mag; de actieve database niet.
        // Daarom staat de doelmap er los bij, met de lijst van wat daar staat.
        opDoelmap: opties.doelmap === null ? [] : lijstBackups(opties.doelmap),
        stand: laatsteStand(request.core.handle),
        instellingen: opties,
        map: backupmap(request),
        logboek: logboek(request.core.handle, 25),
      },
    };
  });

  /** Nu een back-up maken. */
  app.post('/api/v1/backups', async (request) => {
    const gebruiker = requireRole(request, 'admin');
    const opties = instellingen(request);
    const body = (request.body ?? {}) as Rij;
    const naarDoelmap = body.naarDoelmap === true && opties.doelmap !== null;

    const uitkomst = vang(() =>
      maakBackup(request.core.handle, databasepad(request), backupmap(request), {
        soort: 'handmatig',
        doelmap: naarDoelmap ? (opties.doelmap ?? undefined) : undefined,
        gebruikerId: gebruiker.id,
      }),
    );

    return { data: uitkomst };
  });

  /**
   * Controleren of een back-up bruikbaar is, zonder hem terug te zetten.
   *
   * Dit is de knop die je vóór een herstel indrukt, en die je ook af en toe
   * hoort in te drukken zonder herstel — een back-up die je nooit controleert
   * is een aanname, geen back-up.
   */
  app.post('/api/v1/backups/:naam/check', async (request) => {
    requireRole(request, 'admin');
    const naam = String((request.params as Rij).naam);
    const bestand = lijstBackups(backupmap(request)).find(
      (kandidaat) => kandidaat.bestandsnaam === naam,
    );

    if (bestand === undefined) {
      throw new ApiError(404, 'niet_gevonden', `De back-up ${naam} staat niet in de back-upmap.`);
    }

    vang(() => controleerBruikbaar(bestand.pad));

    return { data: { bestandsnaam: naam, bruikbaar: true, bytes: bestand.bytes } };
  });

  /**
   * Waar de actieve database staat, en of dat een verstandige plek is.
   *
   * Het antwoord van `checkDatabasePath` staat hier zodat het beheerscherm het
   * kan tonen: een database op een netwerkschijf of in een OneDrive-map raakt
   * beschadigd, en dat wil je zien vóórdat het gebeurt.
   */
  app.get('/api/v1/backups/locatie', async (request) => {
    requireRole(request, 'admin');

    return {
      data: {
        database: databasepad(request),
        map: request.core.dataDirectory,
        oordeel: checkDatabasePath(databasepad(request)),
      },
    };
  });
}
