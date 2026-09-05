/** Endpoints voor rapportages en export (hoofdstuk 11). */
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { formatDate } from '@showroom/shared';
import { DATABASE_BESTANDSNAAM } from '../../db/client.ts';
import { ApiError, currentUser, requireRole } from '../../server.ts';
import { maakCsv } from '../export/csv.ts';
import { maakDocument } from '../export/docx.ts';
import { maakWerkmap, type Kolom } from '../export/xlsx.ts';
import {
  beschikbareEntiteiten,
  BouwerFout,
  draaiBouwer,
  type Bouwdefinitie,
} from './builder.ts';
import { beschrijfSchema, MAX_RIJEN, SqlFout, voerSqlUit, type SqlUitkomst } from './sql.ts';

type Rij = Record<string, unknown>;

/** Waar de databasefile staat. De read-only lezer opent hetzelfde bestand. */
function databasepad(request: FastifyRequest): string {
  return join(request.core.dataDirectory, DATABASE_BESTANDSNAAM);
}

/** Vertaalt een modulefout naar een nette API-fout. */
function vang<T>(fn: () => T): T {
  try {
    return fn();
  } catch (fout) {
    if (fout instanceof BouwerFout || fout instanceof SqlFout) {
      throw new ApiError(400, fout.code, fout.message);
    }
    throw fout;
  }
}

/** Leest een bouwdefinitie uit de body en controleert de vorm globaal. */
function leesDefinitie(body: unknown): Bouwdefinitie {
  const rij = (body ?? {}) as Rij;
  const entiteit = String(rij.entiteit ?? '');

  if (entiteit === '') {
    throw new ApiError(400, 'onvolledig', 'Kies over welke gegevens de rapportage gaat.');
  }
  if (!Array.isArray(rij.kolommen)) {
    throw new ApiError(400, 'onvolledig', 'Kies minstens één kolom voor de rapportage.');
  }

  return {
    entiteit,
    kolommen: rij.kolommen as Bouwdefinitie['kolommen'],
    filter: (rij.filter ?? null) as Bouwdefinitie['filter'],
    sortering: Array.isArray(rij.sortering)
      ? (rij.sortering as Bouwdefinitie['sortering'])
      : undefined,
    groepering: Array.isArray(rij.groepering) ? rij.groepering.map(String) : undefined,
    limiet: typeof rij.limiet === 'number' ? rij.limiet : undefined,
    metGearchiveerde: rij.metGearchiveerde === true,
  };
}

/** Een bestandsnaam zonder tekens waar Windows over valt. */
export function veiligeBestandsnaam(naam: string, extensie: string): string {
  const schoon = naam
    // eslint-disable-next-line no-control-regex -- juist die tekens moeten weg
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${schoon === '' ? 'rapportage' : schoon}.${extensie}`;
}

type Uitvoer = { uitkomst: SqlUitkomst; kolommen: Kolom[] };

/**
 * Draait wat de body vraagt: de bouwer, of de SQL-modus.
 *
 * Beide leveren dezelfde vorm op, zodat de export erachter niet hoeft te weten
 * waar de rijen vandaan komen.
 */
function draai(request: FastifyRequest): Uitvoer {
  const body = (request.body ?? {}) as Rij;

  if (typeof body.sql === 'string' && body.sql.trim() !== '') {
    // De SQL-modus is voor beheerders. Een manager mag rapporteren, niet
    // rondstruinen in tabellen waar de schermen hem niet bij laten.
    requireRole(request, 'admin');

    const uitkomst = vang(() =>
      voerSqlUit(
        databasepad(request),
        body.sql as string,
        typeof body.limiet === 'number' ? body.limiet : MAX_RIJEN,
      ),
    );

    // Bij vrije SQL weten we het soort waarde niet; alles wordt tekst, en dat
    // is eerlijker dan een gok die in Excel een verkeerd bedrag oplevert.
    return {
      uitkomst,
      kolommen: uitkomst.kolommen.map((naam) => ({ sleutel: naam, kop: naam })),
    };
  }

  currentUser(request);
  const definitie = leesDefinitie(body);
  const gedraaid = vang(() => draaiBouwer(request.core.handle, databasepad(request), definitie));

  return { uitkomst: gedraaid.uitkomst, kolommen: gedraaid.kolommen };
}

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  /** Waar een rapportage over kan gaan, met de kolommen per gegevenssoort. */
  app.get('/api/v1/reports/entities', async (request) => {
    currentUser(request);
    return { data: beschikbareEntiteiten(request.core.handle) };
  });

  /** Het volledige schema, voor de SQL-modus. Alleen voor beheerders. */
  app.get('/api/v1/reports/schema', async (request) => {
    requireRole(request, 'admin');
    return { data: beschrijfSchema(request.core.handle) };
  });

  /** Een rapportage draaien en het resultaat teruggeven. */
  app.post('/api/v1/reports/run', async (request) => {
    const { uitkomst, kolommen } = draai(request);

    return {
      data: { kolommen, rijen: uitkomst.rijen },
      meta: {
        aantal: uitkomst.rijen.length,
        afgekapt: uitkomst.afgekapt,
        duurMs: uitkomst.duurMs,
        maxRijen: MAX_RIJEN,
      },
    };
  });

  /**
   * Dezelfde rapportage, maar als bestand.
   *
   * De schil schrijft het weg met de opslaan-dialoog; de kern levert alleen de
   * inhoud. Binaire formaten gaan als base64 door de JSON heen — een aparte
   * binaire route zou netter zijn, maar dan moet de schil twee soorten
   * antwoorden aankunnen voor één knop.
   */
  app.post('/api/v1/reports/export', async (request) => {
    const body = (request.body ?? {}) as Rij;
    const formaat = String(body.formaat ?? 'xlsx');
    const titel = typeof body.titel === 'string' && body.titel !== '' ? body.titel : 'Rapportage';

    const { uitkomst, kolommen } = draai(request);
    const gebruiker = currentUser(request);

    const ondertitels = [
      `Gemaakt op ${formatDate(new Date())} door ${gebruiker.name}`,
      `${uitkomst.rijen.length} ${uitkomst.rijen.length === 1 ? 'regel' : 'regels'}${
        uitkomst.afgekapt ? ` (afgekapt op ${MAX_RIJEN})` : ''
      }`,
    ];

    switch (formaat) {
      case 'xlsx':
        return {
          data: {
            bestandsnaam: veiligeBestandsnaam(titel, 'xlsx'),
            codering: 'base64',
            inhoud: maakWerkmap({ naam: titel, kolommen, rijen: uitkomst.rijen }).toString('base64'),
          },
        };

      case 'docx':
        return {
          data: {
            bestandsnaam: veiligeBestandsnaam(titel, 'docx'),
            codering: 'base64',
            inhoud: maakDocument({
              titel,
              ondertitels,
              kolommen,
              rijen: uitkomst.rijen,
              voetnoot: null,
            }).toString('base64'),
          },
        };

      case 'csv':
        return {
          data: {
            bestandsnaam: veiligeBestandsnaam(titel, 'csv'),
            codering: 'tekst',
            inhoud: maakCsv(kolommen, uitkomst.rijen),
          },
        };

      default:
        throw new ApiError(
          400,
          'onbekend_formaat',
          `"${formaat}" is geen bekend exportformaat. Kies xlsx, docx of csv.`,
        );
    }
  });

  /** De opgeslagen rapportages die deze gebruiker mag zien. */
  app.get('/api/v1/reports/saved', async (request) => {
    const gebruiker = currentUser(request);

    const rijen = request.core.handle.raw
      .prepare(
        `SELECT q.*, u.name AS eigenaar
           FROM saved_queries q
      LEFT JOIN users u ON u.id = q.owner_user_id
          WHERE q.archived_at IS NULL
            AND (q.is_shared = 1 OR q.owner_user_id = ?)
       ORDER BY q.name`,
      )
      .all(gebruiker.id) as Rij[];

    return { data: rijen.map(leesOpgeslagen) };
  });

  /** Een rapportage bewaren. */
  app.post('/api/v1/reports/saved', async (request) => {
    const gebruiker = currentUser(request);
    const body = (request.body ?? {}) as Rij;
    const naam = String(body.naam ?? '').trim();

    if (naam === '') {
      throw new ApiError(400, 'onvolledig', 'Geef de rapportage een naam.');
    }

    const sql = typeof body.sql === 'string' && body.sql.trim() !== '' ? body.sql : null;
    if (sql !== null) requireRole(request, 'admin');

    request.core.handle.raw
      .prepare(
        `INSERT INTO saved_queries (name, description, mode, builder, sql, owner_user_id, is_shared)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        naam,
        typeof body.omschrijving === 'string' ? body.omschrijving : null,
        sql === null ? 'builder' : 'sql',
        sql === null ? JSON.stringify(body.definitie ?? {}) : null,
        sql,
        gebruiker.id,
        body.gedeeld === true ? 1 : 0,
      );

    const rij = request.core.handle.raw
      .prepare('SELECT * FROM saved_queries WHERE id = last_insert_rowid()')
      .get() as Rij;

    return { data: leesOpgeslagen(rij) };
  });

  /**
   * Een opgeslagen rapportage verwijderen.
   *
   * Alleen de eigenaar of een beheerder. Een gedeelde rapportage die iemand
   * anders gebruikt mag niet zomaar onder hem vandaan verdwijnen.
   */
  app.delete('/api/v1/reports/saved/:id', async (request) => {
    const gebruiker = currentUser(request);
    const id = Number((request.params as Rij).id);

    const rij = request.core.handle.raw
      .prepare('SELECT owner_user_id FROM saved_queries WHERE id = ? AND archived_at IS NULL')
      .get(id) as { owner_user_id: number | null } | undefined;

    if (rij === undefined) {
      throw new ApiError(404, 'niet_gevonden', 'Deze rapportage bestaat niet (meer).');
    }
    if (rij.owner_user_id !== gebruiker.id && gebruiker.role !== 'admin') {
      throw new ApiError(
        403,
        'geen_rechten',
        'Alleen wie de rapportage gemaakt heeft, of een beheerder, kan hem verwijderen.',
      );
    }

    request.core.handle.raw
      .prepare("UPDATE saved_queries SET archived_at = datetime('now') WHERE id = ?")
      .run(id);

    return { data: { id, verwijderd: true } };
  });
}

/** Zet een databaserij om in wat het scherm verwacht. */
function leesOpgeslagen(rij: Rij): Rij {
  let definitie: unknown = null;
  try {
    definitie = rij.builder === null ? null : JSON.parse(String(rij.builder));
  } catch {
    // Een onleesbare definitie levert een rapportage op die je niet kunt
    // openen, maar wel kunt zien staan en verwijderen. Beter dan een lijst die
    // helemaal niet laadt.
    definitie = null;
  }

  return {
    id: rij.id,
    naam: rij.name,
    omschrijving: rij.description,
    modus: rij.mode,
    definitie,
    sql: rij.sql,
    gedeeld: Number(rij.is_shared ?? 0) === 1,
    eigenaar: rij.eigenaar ?? null,
    eigenaarId: rij.owner_user_id,
  };
}
