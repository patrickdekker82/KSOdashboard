/**
 * Back-up en herstel (hoofdstuk 12).
 *
 * Een SQLite-database kopiëren met `copyFile` is niet veilig zolang er iemand
 * in werkt: onder WAL staat een deel van de wijzigingen nog in het
 * `-wal`-bestand en dan is de kopie een halve database. `VACUUM INTO` doet het
 * wel goed — SQLite schrijft zelf een consistent, compact bestand weg, ook
 * terwijl er doorgewerkt wordt.
 *
 * Twee dingen die verder tellen:
 *
 *   - De actieve database mag nooit op een netwerkschijf of in een
 *     synchronisatiemap staan (hoofdstuk 12); back-upkopieën juist wél. Die
 *     regel wordt hier omgedraaid toegepast: `checkDatabasePath` blokkeert de
 *     actieve locatie, en de back-updoelmap mag alles zijn.
 *   - Herstellen begint met een back-up van wat er nu staat. Wie een verkeerde
 *     back-up terugzet moet dat kunnen terugdraaien.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';

export class BackupFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BackupFout';
    this.code = code;
  }
}

/** Waar een back-up vandaan komt. Bepaalt ook de bestandsnaam. */
export type Soort = 'handmatig' | 'automatisch' | 'voor_migratie' | 'voor_herstel';

const VOORVOEGSEL: Record<Soort, string> = {
  handmatig: 'showroom-handmatig',
  automatisch: 'showroom-automatisch',
  voor_migratie: 'showroom-voor-migratie',
  voor_herstel: 'showroom-voor-herstel',
};

/**
 * Een tijdstempel die in een bestandsnaam past en op naam sorteert.
 *
 * `2026-09-07T14-30` — geen dubbele punten (Windows staat die niet toe in een
 * bestandsnaam) en geen seconden, want twee back-ups binnen een minuut komen
 * niet voor en de naam wordt er alleen langer van.
 */
export function tijdstempel(moment: Date): string {
  return moment.toISOString().slice(0, 16).replace(/:/g, '-');
}

export function bestandsnaamVoor(soort: Soort, moment: Date): string {
  return `${VOORVOEGSEL[soort]}-${tijdstempel(moment)}.db`;
}

export type Backup = {
  bestandsnaam: string;
  pad: string;
  bytes: number;
  /** ISO-tijdstempel van het bestand zelf, niet van de logregel. */
  gemaaktOp: string;
  soort: Soort | 'onbekend';
};

/** Uit welke soort een bestandsnaam komt. */
function soortVan(bestandsnaam: string): Soort | 'onbekend' {
  for (const [soort, voorvoegsel] of Object.entries(VOORVOEGSEL)) {
    if (bestandsnaam.startsWith(voorvoegsel)) return soort as Soort;
  }
  return 'onbekend';
}

/** De back-ups die er staan, nieuwste eerst. */
export function lijstBackups(map: string): Backup[] {
  if (!existsSync(map)) return [];

  return readdirSync(map)
    .filter((bestand) => bestand.endsWith('.db'))
    .map((bestand) => {
      const pad = join(map, bestand);
      const gegevens = statSync(pad);
      return {
        bestandsnaam: bestand,
        pad,
        bytes: gegevens.size,
        gemaaktOp: new Date(gegevens.mtimeMs).toISOString(),
        soort: soortVan(bestand),
      };
    })
    .sort((a, b) => b.gemaaktOp.localeCompare(a.gemaaktOp));
}

export type BackupUitkomst = {
  bestandsnaam: string;
  pad: string;
  bytes: number;
  duurMs: number;
  opgeruimd: number;
};

export type BackupOpties = {
  soort?: Soort;
  /** Waar de kopie heen gaat. Standaard de back-upmap naast de database. */
  doelmap?: string;
  /** Hoeveel back-ups van deze soort blijven staan. 0 = alles bewaren. */
  bewaar?: number;
  /** Wie het startte; `null` voor de nachtelijke loop. */
  gebruikerId?: number | null;
  nu?: Date;
};

/**
 * Maakt een back-up en schrijft de uitkomst in `backup_runs`.
 *
 * Ook een mislukte poging komt in het logboek. Dat is het hele punt: een
 * back-up die stilletjes niet draait is erger dan een die luidruchtig faalt.
 */
export function maakBackup(
  handle: DatabaseHandle,
  databasepad: string,
  backupmap: string,
  opties: BackupOpties = {},
): BackupUitkomst {
  const soort = opties.soort ?? 'handmatig';
  const nu = opties.nu ?? new Date();
  const doelmap = opties.doelmap ?? backupmap;
  const bestandsnaam = bestandsnaamVoor(soort, nu);
  const doel = join(doelmap, bestandsnaam);
  const begin = Date.now();

  try {
    if (!existsSync(databasepad)) {
      throw new BackupFout(
        'geen_database',
        `Er staat geen database op ${databasepad}. Er valt niets te kopiëren.`,
      );
    }

    mkdirSync(doelmap, { recursive: true });

    if (existsSync(doel)) {
      throw new BackupFout(
        'bestaat_al',
        `Er staat al een back-up met de naam ${bestandsnaam}. Wacht een minuut of geef hem zelf een naam.`,
      );
    }

    schrijfConsistenteKopie(databasepad, doel);

    const bytes = statSync(doel).size;
    const opgeruimd = opties.bewaar === undefined || opties.bewaar <= 0
      ? 0
      : ruimOp(doelmap, VOORVOEGSEL[soort], opties.bewaar);
    const duurMs = Date.now() - begin;

    legVast(handle, {
      soort,
      bestandsnaam,
      pad: doel,
      bytes,
      duurMs,
      status: 'ok',
      fout: null,
      opgeruimd,
      gebruikerId: opties.gebruikerId ?? null,
    });

    return { bestandsnaam, pad: doel, bytes, duurMs, opgeruimd };
  } catch (fout) {
    const melding = fout instanceof Error ? fout.message : String(fout);

    legVast(handle, {
      soort,
      bestandsnaam,
      pad: doel,
      bytes: 0,
      duurMs: Date.now() - begin,
      status: 'fout',
      fout: melding,
      opgeruimd: 0,
      gebruikerId: opties.gebruikerId ?? null,
    });

    throw fout instanceof BackupFout
      ? fout
      : new BackupFout('back_up_mislukt', `De back-up is niet gelukt: ${melding}`);
  }
}

/**
 * Schrijft een consistente kopie weg met `VACUUM INTO`.
 *
 * Een read-only verbinding: er hoeft niets geschreven te worden aan de bron,
 * en zo kan een fout hier de echte database niet raken. De naam van het
 * doelbestand gaat als gebonden parameter mee — `VACUUM INTO` accepteert dat,
 * en dan hoeft er geen pad in de SQL-tekst geplakt te worden.
 */
function schrijfConsistenteKopie(bron: string, doel: string): void {
  const lezer = new DatabaseSync(bron, { open: true, readOnly: true });
  try {
    lezer.prepare('VACUUM INTO ?').run(doel);
  } finally {
    lezer.close();
  }
}

/** Houdt de nieuwste `bewaar` back-ups van een soort en gooit de rest weg. */
export function ruimOp(map: string, voorvoegsel: string, bewaar: number): number {
  if (!existsSync(map) || bewaar <= 0) return 0;

  const bestanden = readdirSync(map)
    .filter((bestand) => bestand.startsWith(voorvoegsel) && bestand.endsWith('.db'))
    .map((bestand) => ({ bestand, op: statSync(join(map, bestand)).mtimeMs }))
    .sort((a, b) => b.op - a.op);

  let weg = 0;
  for (const entry of bestanden.slice(bewaar)) {
    unlinkSync(join(map, entry.bestand));
    weg += 1;
  }
  return weg;
}

export type Hersteld = {
  teruggezet: string;
  /** De veiligheidskopie van wat er stond, voor het geval het de verkeerde was. */
  veiligheidskopie: string;
};

/**
 * Zet een back-up terug.
 *
 * De volgorde is met opzet zo:
 *
 *   1. controleer dat het bestand bestaat, in de back-upmap staat en een
 *      leesbare SQLite-database is
 *   2. maak een veiligheidskopie van wat er nu staat
 *   3. zet de back-up ernaast neer
 *   4. wissel de bestanden om
 *
 * Stap 1 vóór stap 2, want een veiligheidskopie maken van een database die
 * daarna toch niet vervangen wordt is alleen maar verwarrend. Stap 3 en 4
 * apart, zodat er geen moment is waarop er helemaal geen database staat.
 *
 * De aanroeper moet de databaseverbinding hebben gesloten. Dat kan deze functie
 * niet zelf: hij zou de verbinding sluiten waar hij zelf op schrijft.
 */
export function herstelBackup(
  databasepad: string,
  backupmap: string,
  bestandsnaam: string,
  nu = new Date(),
): Hersteld {
  const veilig = basename(bestandsnaam);
  if (veilig !== bestandsnaam || veilig === '') {
    throw new BackupFout(
      'ongeldige_naam',
      'Geef alleen de bestandsnaam op, zonder mappen ervoor.',
    );
  }

  const bron = join(backupmap, veilig);
  if (resolve(bron) !== join(resolve(backupmap), veilig) || !existsSync(bron)) {
    throw new BackupFout('niet_gevonden', `De back-up ${veilig} staat niet in de back-upmap.`);
  }

  controleerBruikbaar(bron);

  const veiligheidskopie = join(backupmap, bestandsnaamVoor('voor_herstel', nu));
  if (existsSync(databasepad)) {
    // Hier wél een gewone kopie en geen VACUUM INTO: de applicatie ligt op dit
    // moment stil, en we willen een letterlijke kopie van het bestand zoals het
    // is — inclusief eventuele schade, want dat is wat je wil kunnen
    // terugdraaien.
    copyFileSync(databasepad, veiligheidskopie);
  }

  // Eerst ernaast, dan omwisselen: er is geen moment zonder database.
  const tijdelijk = `${databasepad}.nieuw`;
  copyFileSync(bron, tijdelijk);

  // De WAL- en shm-bestanden horen bij de oude database en zouden na het
  // omwisselen niet meer kloppen.
  for (const achtervoegsel of ['-wal', '-shm']) {
    const zijbestand = `${databasepad}${achtervoegsel}`;
    if (existsSync(zijbestand)) unlinkSync(zijbestand);
  }

  renameSync(tijdelijk, databasepad);

  return { teruggezet: veilig, veiligheidskopie: basename(veiligheidskopie) };
}

/**
 * Kijkt of een bestand echt een bruikbare SQLite-database van deze applicatie
 * is voordat het de actieve database vervangt.
 *
 * Een integriteitscontrole plus de vraag of `schema_migrations` erin staat.
 * Zonder die tweede check kun je een willekeurige SQLite-database terugzetten
 * en staat de applicatie daarna leeg te kijken.
 */
export function controleerBruikbaar(pad: string): void {
  let lezer: DatabaseSync | null = null;
  try {
    lezer = new DatabaseSync(pad, { open: true, readOnly: true });

    const uitkomst = lezer.prepare('PRAGMA integrity_check').get() as
      | Record<string, unknown>
      | undefined;
    const antwoord = String(Object.values(uitkomst ?? {})[0] ?? '');
    if (antwoord !== 'ok') {
      throw new BackupFout(
        'beschadigd',
        `Deze back-up is beschadigd (${antwoord}) en wordt niet teruggezet.`,
      );
    }

    const tabel = lezer
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get();
    if (tabel === undefined) {
      throw new BackupFout(
        'geen_showroom_database',
        'Dit bestand is wel een database, maar niet die van Showroom Suite.',
      );
    }
  } catch (fout) {
    if (fout instanceof BackupFout) throw fout;
    throw new BackupFout(
      'onleesbaar',
      `Dit bestand is geen leesbare database: ${fout instanceof Error ? fout.message : String(fout)}`,
    );
  } finally {
    lezer?.close();
  }
}

type Logregel = {
  soort: Soort;
  bestandsnaam: string | null;
  pad: string | null;
  bytes: number;
  duurMs: number;
  status: 'ok' | 'fout';
  fout: string | null;
  opgeruimd: number;
  gebruikerId: number | null;
};

function legVast(handle: DatabaseHandle, regel: Logregel): void {
  handle.raw
    .prepare(
      `INSERT INTO backup_runs
         (soort, bestandsnaam, pad, bytes, duur_ms, status, fout, opgeruimd, gestart_door)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      regel.soort,
      regel.bestandsnaam,
      regel.pad,
      regel.bytes,
      regel.duurMs,
      regel.status,
      regel.fout,
      regel.opgeruimd,
      regel.gebruikerId,
    );
}

/** De laatste loops, voor het beheerscherm. */
export function logboek(handle: DatabaseHandle, limiet = 50): Array<Record<string, unknown>> {
  return handle.raw
    .prepare(
      `SELECT b.*, u.name AS gebruiker
         FROM backup_runs b
    LEFT JOIN users u ON u.id = b.gestart_door
     ORDER BY b.created_at DESC, b.id DESC
        LIMIT ?`,
    )
    .all(limiet) as Array<Record<string, unknown>>;
}

/**
 * Wanneer er voor het laatst een back-up gelukt is, en of de laatste poging
 * mislukte. Dit voedt de signaleringsregel.
 */
export function laatsteStand(handle: DatabaseHandle): {
  laatsteGelukt: string | null;
  laatstePoging: string | null;
  laatsteMislukt: boolean;
  fout: string | null;
} {
  const gelukt = handle.raw
    .prepare("SELECT created_at FROM backup_runs WHERE status = 'ok' ORDER BY created_at DESC LIMIT 1")
    .get() as { created_at: string } | undefined;

  const poging = handle.raw
    .prepare('SELECT created_at, status, fout FROM backup_runs ORDER BY created_at DESC, id DESC LIMIT 1')
    .get() as { created_at: string; status: string; fout: string | null } | undefined;

  return {
    laatsteGelukt: gelukt?.created_at ?? null,
    laatstePoging: poging?.created_at ?? null,
    laatsteMislukt: poging?.status === 'fout',
    fout: poging?.fout ?? null,
  };
}

/**
 * Een verbinding openen om na een herstel weer verder te kunnen.
 *
 * Staat hier zodat de aanroeper niet zelf hoeft te weten met welke instellingen
 * de database open moet.
 */
export function heropen(databasepad: string): DatabaseHandle {
  return openDatabase(databasepad);
}
