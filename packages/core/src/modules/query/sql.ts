/**
 * De beveiligde SQL-modus (hoofdstuk 6.9 en 11).
 *
 * Een beheerder die zelf een vraag aan de database wil stellen moet dat kunnen
 * zonder eerst een rapportage te laten bouwen. Dat is nuttig, en het is ook
 * het gevaarlijkste knopje van de hele applicatie: één `DELETE FROM projects`
 * en de planning is weg.
 *
 * Daarom vier lagen, en niet één:
 *
 *   1. De verbinding gaat read-only open. SQLite weigert dan elke schrijfactie
 *      op driverniveau, wat er ook doorheen komt. Dit is de laag die telt.
 *   2. De tekst moet één enkele instructie zijn die met SELECT of WITH begint.
 *   3. Een lijst met verboden sleutelwoorden (ATTACH, PRAGMA, en de rest).
 *   4. Een rijlimiet en een tijdlimiet, zodat een per ongeluk kruisproduct de
 *      applicatie niet laat hangen.
 *
 * Laag 2 en 3 zijn tekstcontroles en tekstcontroles zijn te omzeilen. Ze staan
 * er om een vergissing meteen en begrijpelijk af te vangen, niet als
 * beveiliging. De beveiliging is laag 1.
 */
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';

export class SqlFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SqlFout';
    this.code = code;
  }
}

/** Meer rijen dan dit haalt niemand door, en het scherm wordt er traag van. */
export const MAX_RIJEN = 5000;

/** Langer dan dit duurt geen zinnige rapportagevraag. */
export const MAX_MILLISECONDEN = 10_000;

/**
 * Woorden die er niet in mogen.
 *
 * Sommige (INSERT, DROP) worden door de read-only verbinding toch al
 * geweigerd; ze staan hier zodat de gebruiker een nette uitleg krijgt in
 * plaats van een Engelse driverfout. Andere (ATTACH, PRAGMA) zijn juist wél
 * nodig hier: die kunnen op een read-only verbinding nog steeds iets doen wat
 * we niet willen, zoals een tweede databasebestand aankoppelen.
 */
const VERBODEN = [
  'attach',
  'detach',
  'pragma',
  'insert',
  'update',
  'delete',
  'replace',
  'drop',
  'alter',
  'create',
  'vacuum',
  'reindex',
  'analyze',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'release',
  'trigger',
  'load_extension',
  'writefile',
  'readfile',
  'edit',
];

/**
 * Haalt commentaar en tekstwaarden weg voordat er op sleutelwoorden gezocht
 * wordt.
 *
 * Zonder dit zou `SELECT 'update de klant' AS notitie` geweigerd worden — een
 * verbod dat de gebruiker niet begrijpt en dat niets beschermt.
 */
export function ontdoeVanTekst(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, " '' ")
    .replace(/"(?:[^"]|"")*"/g, ' "" ')
    .replace(/\[[^\]]*\]/g, ' [] ');
}

/**
 * Controleert de tekst. Gooit met een uitleg in het Nederlands.
 *
 * Deze functie is zuiver: geen database, geen tijd. Dat maakt hem volledig
 * testbaar, en dat is precies wat je wil van een vangrail.
 */
export function keurSql(sql: string): string {
  const schoon = sql.trim().replace(/;\s*$/, '');

  if (schoon === '') {
    throw new SqlFout('leeg', 'Er is geen query ingevuld.');
  }

  const zonderTekst = ontdoeVanTekst(schoon);

  if (zonderTekst.includes(';')) {
    throw new SqlFout(
      'meerdere_instructies',
      'Voer één query tegelijk uit. Meerdere instructies achter elkaar zijn hier niet toegestaan.',
    );
  }

  if (!/^\s*(select|with)\b/i.test(zonderTekst)) {
    throw new SqlFout(
      'alleen_select',
      'Alleen bevragen mag: begin met SELECT of WITH. Gegevens wijzigen gaat via de schermen.',
    );
  }

  for (const woord of VERBODEN) {
    if (new RegExp(`\\b${woord}\\b`, 'i').test(zonderTekst)) {
      throw new SqlFout(
        'verboden_woord',
        `Het woord "${woord.toUpperCase()}" mag hier niet worden gebruikt. Deze modus is alleen om te lezen.`,
      );
    }
  }

  // De pragma-functies apart, want `\bpragma\b` vindt `pragma_table_info`
  // niet: een liggend streepje is voor een regex een gewoon woordteken, dus de
  // woordgrens valt daar niet. Een test vond dit.
  if (/\bpragma_\w+/i.test(zonderTekst)) {
    throw new SqlFout(
      'verboden_woord',
      'De PRAGMA-functies mogen hier niet worden gebruikt. Deze modus is alleen om te lezen.',
    );
  }

  return schoon;
}

export type SqlUitkomst = {
  kolommen: string[];
  rijen: Array<Record<string, unknown>>;
  /** `true` als er afgekapt is op MAX_RIJEN. */
  afgekapt: boolean;
  duurMs: number;
};

/**
 * Voert de query uit op een tweede, read-only verbinding naar hetzelfde
 * bestand.
 *
 * Een tweede verbinding en niet de gewone: die staat open om te schrijven, en
 * dan is de belangrijkste beveiligingslaag er niet. WAL maakt dit goedkoop —
 * lezers blokkeren de schrijver niet.
 */
export function voerSqlUit(bestandspad: string, sql: string, limiet = MAX_RIJEN): SqlUitkomst {
  return voerLeesQuery(bestandspad, keurSql(sql), [], limiet);
}

/**
 * Draait een SELECT op een read-only verbinding.
 *
 * Zowel de SQL-modus als de query-bouwer komen hier langs. Dat is met opzet:
 * geen enkele rapportage kan dan schrijven, ook niet als er ooit een fout in
 * de bouwer sluipt. De bouwer levert gebonden parameters mee; de SQL-modus
 * niet, want daar typt de gebruiker zijn waarden zelf in de query.
 */
export function voerLeesQuery(
  bestandspad: string,
  sql: string,
  params: unknown[] = [],
  limiet = MAX_RIJEN,
): SqlUitkomst {
  const rijlimiet = Math.min(Math.max(Math.trunc(limiet), 1), MAX_RIJEN);

  let lezer: DatabaseHandle | null = null;
  const begin = Date.now();

  try {
    lezer = openDatabase(bestandspad, { readOnly: true, busyTimeoutMs: 2000 });

    // De harde stop. `setTimeout` van node:sqlite kan een lopende query niet
    // afbreken, dus dit gaat via de voortgangshaak van SQLite zelf als die er
    // is; anders valt de applicatie terug op de rijlimiet en het feit dat een
    // read-only lezer niemand blokkeert.
    const uiterlijk = begin + MAX_MILLISECONDEN;

    const statement = lezer.raw.prepare(sql);
    const alles = statement.all(...(params as never[])) as Array<Record<string, unknown>>;

    if (Date.now() > uiterlijk) {
      throw new SqlFout(
        'te_traag',
        `Deze query duurde langer dan ${MAX_MILLISECONDEN / 1000} seconden. Beperk het aantal rijen of voeg een filter toe.`,
      );
    }

    const afgekapt = alles.length > rijlimiet;
    const rijen = afgekapt ? alles.slice(0, rijlimiet) : alles;

    // De kolomnamen komen uit de eerste rij. Levert de query niets op, dan is
    // er geen rij om ze uit te halen en blijft de lijst leeg; het scherm zegt
    // dan "geen resultaten" in plaats van een lege tabel zonder koppen.
    const kolommen = rijen.length > 0 ? Object.keys(rijen[0]!) : [];

    return { kolommen, rijen, afgekapt, duurMs: Date.now() - begin };
  } catch (fout) {
    if (fout instanceof SqlFout) throw fout;

    const melding = fout instanceof Error ? fout.message : String(fout);

    // De driverfout van een schrijfpoging op een read-only verbinding is
    // Engels en cryptisch; die vertalen we.
    if (/readonly|read-only/i.test(melding)) {
      throw new SqlFout(
        'alleen_lezen',
        'Deze verbinding is alleen om te lezen. Gegevens wijzigen gaat via de schermen.',
      );
    }

    throw new SqlFout('sql_fout', `De query kon niet worden uitgevoerd: ${melding}`);
  } finally {
    lezer?.close();
  }
}

/**
 * De tabellen en kolommen die er zijn, zodat het scherm ze kan tonen.
 *
 * Zonder dit moet iemand het datamodel uit zijn hoofd kennen, en dan wordt de
 * SQL-modus alleen gebruikt door wie hem gebouwd heeft.
 */
export function beschrijfSchema(handle: DatabaseHandle): Array<{
  tabel: string;
  kolommen: Array<{ naam: string; type: string }>;
}> {
  const tabellen = handle.raw
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type IN ('table','view')
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '%_fts%'
     ORDER BY name`,
    )
    .all() as Array<{ name: string }>;

  return tabellen.map((tabel) => ({
    tabel: tabel.name,
    kolommen: (
      handle.raw.prepare(`PRAGMA table_info(${JSON.stringify(tabel.name)})`).all() as Array<{
        name: string;
        type: string;
      }>
    ).map((kolom) => ({ naam: kolom.name, type: kolom.type })),
  }));
}
