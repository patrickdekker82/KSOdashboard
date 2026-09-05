/** Endpoints voor de planningimport (hoofdstuk 11). */
import type { FastifyInstance } from 'fastify';
import { ApiError, currentUser, requireRole } from '../../server.ts';
import { leesCsv } from './csv.ts';
import { ExcelFout, leesWerkblad, type CelWaarde } from './xlsx.ts';
import { stelKoppelingVoor, VELDEN, type Koppeling, type Veld } from './mapping.ts';
import { beoordeel, type Beoordeling, type ImportOpties } from './planning.ts';

type Rij = Record<string, unknown>;

/** Zolang een bestand nog niet is doorgevoerd, staat het hier. */
const OPGESLAGEN = new Map<number, { rijen: CelWaarde[][]; tabblad: string | null }>();

/**
 * Hoeveel voorbeelden er in het geheugen blijven staan.
 *
 * Een bestand van een paar duizend regels is een paar honderd kilobyte, en dit
 * draait lokaal. Meer dan een handvol tegelijk komt niet voor: de oudste valt
 * eruit zodra er een nieuwe bij komt.
 */
const MAX_OPGESLAGEN = 8;

function onthoud(batchId: number, rijen: CelWaarde[][], tabblad: string | null): void {
  OPGESLAGEN.set(batchId, { rijen, tabblad });
  while (OPGESLAGEN.size > MAX_OPGESLAGEN) {
    const oudste = OPGESLAGEN.keys().next().value;
    if (oudste === undefined) break;
    OPGESLAGEN.delete(oudste);
  }
}

/** Leest het geüploade bestand naar rijen met cellen. */
function lees(naam: string, inhoud: Buffer): { rijen: CelWaarde[][]; tabblad: string | null } {
  const kleineLetters = naam.toLowerCase();

  if (kleineLetters.endsWith('.csv') || kleineLetters.endsWith('.txt')) {
    const tekst = inhoud.toString('utf8');
    return { rijen: leesCsv(tekst), tabblad: null };
  }

  if (kleineLetters.endsWith('.xlsx') || kleineLetters.endsWith('.xlsm')) {
    const blad = leesWerkblad(inhoud);
    return { rijen: blad.rijen, tabblad: blad.naam };
  }

  throw new ApiError(
    400,
    'onbekend_bestandstype',
    `"${naam}" wordt niet herkend. Kies een .xlsx of een .csv; een oude .xls kunt u in Excel opnieuw opslaan.`,
  );
}

function opties(body: Rij, koppen: readonly CelWaarde[]): ImportOpties {
  const kopregel = Number(body.kopregel ?? 1);
  if (!Number.isInteger(kopregel) || kopregel < 1) {
    throw new ApiError(400, 'ongeldige_kopregel', 'De kopregel moet een regelnummer zijn.');
  }

  const meegestuurd = body.koppeling as Rij | undefined;
  const koppeling: Koppeling =
    meegestuurd && typeof meegestuurd === 'object'
      ? schoonKoppeling(meegestuurd)
      : stelKoppelingVoor(koppen);

  return {
    kopregel,
    koppeling,
    bestaandeBijwerken: body.bestaandeBijwerken !== false,
  };
}

/** Alleen bekende velden en echte kolomnummers komen door. */
function schoonKoppeling(invoer: Rij): Koppeling {
  const geldig = new Set(VELDEN.map((veld) => veld.veld));
  const koppeling: Koppeling = {};

  for (const [sleutel, waarde] of Object.entries(invoer)) {
    if (!geldig.has(sleutel as Veld)) continue;
    if (waarde === null || waarde === undefined || waarde === '') continue;
    const kolom = Number(waarde);
    if (Number.isInteger(kolom) && kolom >= 0) koppeling[sleutel as Veld] = kolom;
  }

  return koppeling;
}

function samenvatting(beoordeling: Beoordeling): Rij {
  return {
    totaal: beoordeling.totaal,
    nieuw: beoordeling.nieuw,
    bijwerken: beoordeling.bijwerken,
    ongewijzigd: beoordeling.ongewijzigd,
    fout: beoordeling.fout,
  };
}

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  /** De velden waar een planningsbestand op gekoppeld kan worden. */
  app.get('/api/v1/imports/fields', async () => ({ data: VELDEN }));

  /**
   * Stap 1: het bestand inlezen en laten zien wat er zou gebeuren.
   *
   * Er wordt hier niets weggeschreven behalve de batch zelf, zodat het spoor
   * ook een afgebroken poging bevat.
   */
  app.post('/api/v1/imports/preview', async (request, reply) => {
    const gebruiker = requireRole(request, 'manager');
    const bestand = await request.file();
    if (!bestand) throw new ApiError(400, 'geen_bestand', 'Er is geen bestand meegestuurd.');

    const inhoud = await bestand.toBuffer();
    if (bestand.file.truncated) {
      throw new ApiError(413, 'te_groot', 'Dit bestand is te groot om in te lezen.');
    }

    const naam = bestand.filename ?? 'import';
    let gelezen;
    try {
      gelezen = lees(naam, inhoud);
    } catch (error) {
      if (error instanceof ExcelFout) throw new ApiError(400, 'onleesbaar', error.message);
      throw error;
    }

    if (gelezen.rijen.length === 0) {
      throw new ApiError(400, 'leeg_bestand', 'In dit bestand staat geen enkele regel.');
    }

    // De velden uit het formulier komen als multipart-tekstvelden binnen.
    const velden = bestand.fields as Record<string, { value?: unknown } | undefined>;
    const body: Rij = {};
    for (const [sleutel, veld] of Object.entries(velden)) {
      if (sleutel === 'file' || veld === undefined) continue;
      const waarde = veld.value;
      if (typeof waarde !== 'string') continue;
      body[sleutel] = sleutel === 'koppeling' ? veiligJson(waarde) : waarde;
    }
    if (body.bestaandeBijwerken === 'false') body.bestaandeBijwerken = false;

    const instellingen = opties(body, gelezen.rijen[Number(body.kopregel ?? 1) - 1] ?? []);
    const beoordeling = beoordeel(
      request.core.handle,
      gelezen.rijen,
      instellingen,
      gebruiker.id,
      false,
    );

    const handle = request.core.handle;
    const batch = handle.raw
      .prepare(
        `INSERT INTO import_batches
           (soort, bestandsnaam, bestandsgrootte, tabblad, koppeling, status,
            rijen_totaal, rijen_nieuw, rijen_bijgewerkt, rijen_overgeslagen, rijen_fout, created_by)
         VALUES ('planning', ?, ?, ?, ?, 'voorbeeld', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        naam,
        inhoud.byteLength,
        gelezen.tabblad,
        JSON.stringify(instellingen.koppeling),
        beoordeling.totaal,
        beoordeling.nieuw,
        beoordeling.bijwerken,
        beoordeling.ongewijzigd,
        beoordeling.fout,
        gebruiker.id,
      );

    const batchId = Number(batch.lastInsertRowid);
    onthoud(batchId, gelezen.rijen, gelezen.tabblad);

    return reply.code(201).send({
      data: {
        batchId,
        tabblad: gelezen.tabblad,
        kopregel: instellingen.kopregel,
        koppen: gelezen.rijen[instellingen.kopregel - 1] ?? [],
        koppeling: instellingen.koppeling,
        bestaandeBijwerken: instellingen.bestaandeBijwerken,
        rijen: beoordeling.rijen,
        ...samenvatting(beoordeling),
      },
    });
  });

  /**
   * Stap 2: doorvoeren.
   *
   * Het bestand wordt opnieuw beoordeeld in plaats van het voorbeeld weg te
   * schrijven: tussen kijken en doorvoeren kan een collega een project hebben
   * aangemaakt, en dan hoort deze import dat te zien.
   */
  app.post('/api/v1/imports/:id/commit', async (request) => {
    const gebruiker = requireRole(request, 'manager');
    const batchId = Number((request.params as { id: string }).id);
    const handle = request.core.handle;

    const batch = handle.raw
      .prepare('SELECT * FROM import_batches WHERE id = ?')
      .get(batchId) as Rij | undefined;
    if (!batch) throw new ApiError(404, 'niet_gevonden', 'Deze import bestaat niet.');
    if (String(batch.status) === 'doorgevoerd') {
      throw new ApiError(409, 'al_doorgevoerd', 'Deze import is al doorgevoerd.');
    }

    const opgeslagen = OPGESLAGEN.get(batchId);
    if (!opgeslagen) {
      throw new ApiError(
        410,
        'voorbeeld_verlopen',
        'Het ingelezen bestand is niet meer beschikbaar. Kies het opnieuw en bekijk het voorbeeld nog een keer.',
      );
    }

    const body = (request.body ?? {}) as Rij;
    const instellingen = opties(
      { ...body, koppeling: body.koppeling ?? JSON.parse(String(batch.koppeling)) },
      opgeslagen.rijen[Number(body.kopregel ?? 1) - 1] ?? [],
    );

    // Alles of niets: een import die halverwege omvalt, mag geen halve
    // planning achterlaten.
    handle.raw.exec('BEGIN');
    let beoordeling: Beoordeling;
    try {
      beoordeling = beoordeel(handle, opgeslagen.rijen, instellingen, gebruiker.id, true);

      handle.raw
        .prepare(
          `UPDATE import_batches
              SET status = 'doorgevoerd', committed_at = datetime('now'), koppeling = ?,
                  rijen_totaal = ?, rijen_nieuw = ?, rijen_bijgewerkt = ?,
                  rijen_overgeslagen = ?, rijen_fout = ?
            WHERE id = ?`,
        )
        .run(
          JSON.stringify(instellingen.koppeling),
          beoordeling.totaal,
          beoordeling.nieuw,
          beoordeling.bijwerken,
          beoordeling.ongewijzigd,
          beoordeling.fout,
          batchId,
        );

      const invoegen = handle.raw.prepare(
        `INSERT INTO import_rows
           (batch_id, bronregel, oordeel, project_id, ruw, waarden, meldingen, doorgevoerd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const rij of beoordeling.rijen) {
        invoegen.run(
          batchId,
          rij.bronregel,
          rij.oordeel,
          rij.projectId,
          JSON.stringify(rij.ruw),
          JSON.stringify(rij.waarden),
          JSON.stringify(rij.meldingen),
          rij.oordeel === 'nieuw' || rij.oordeel === 'bijwerken' ? 1 : 0,
        );
      }

      handle.raw.exec('COMMIT');
    } catch (error) {
      handle.raw.exec('ROLLBACK');
      throw error;
    }

    OPGESLAGEN.delete(batchId);
    return { data: { batchId, ...samenvatting(beoordeling), rijen: beoordeling.rijen } };
  });

  /** De importgeschiedenis. */
  app.get('/api/v1/imports', async (request) => {
    currentUser(request);
    const rijen = request.core.handle.raw
      .prepare(
        `SELECT b.*, u.name AS door FROM import_batches b
      LEFT JOIN users u ON u.id = b.created_by
          ORDER BY b.created_at DESC, b.id DESC
          LIMIT 50`,
      )
      .all() as Rij[];
    return { data: rijen };
  });

  /** Eén import, met de rijen die zijn weggeschreven. */
  app.get('/api/v1/imports/:id', async (request) => {
    currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const handle = request.core.handle;

    const batch = handle.raw.prepare('SELECT * FROM import_batches WHERE id = ?').get(id) as
      | Rij
      | undefined;
    if (!batch) throw new ApiError(404, 'niet_gevonden', 'Deze import bestaat niet.');

    const rijen = handle.raw
      .prepare(
        `SELECT r.*, p.name AS project FROM import_rows r
      LEFT JOIN projects p ON p.id = r.project_id
          WHERE r.batch_id = ? ORDER BY r.bronregel`,
      )
      .all(id) as Rij[];

    return { data: { batch, rijen } };
  });
}

/** JSON uit een formulierveld; onleesbare invoer levert een nette fout op. */
function veiligJson(waarde: string): Rij {
  try {
    const ontleed = JSON.parse(waarde) as unknown;
    return ontleed !== null && typeof ontleed === 'object' ? (ontleed as Rij) : {};
  } catch {
    throw new ApiError(400, 'ongeldige_koppeling', 'De kolomkoppeling kon niet worden gelezen.');
  }
}
