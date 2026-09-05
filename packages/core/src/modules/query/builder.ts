/**
 * De query-bouwer (hoofdstuk 11).
 *
 * Een rapportage in de bouwer is: een entiteit, een stel kolommen, een filter,
 * een sortering en eventueel een groepering. Daar wordt hier SQL van gemaakt.
 *
 * Het verschil met de SQL-modus is dat hier niets van de gebruiker in de query
 * terechtkomt. Kolomnamen worden getoetst aan de kolommen die de tabel écht
 * heeft — niet aan een lijst die iemand ooit heeft bijgehouden, want die loopt
 * achter zodra er een maatwerkveld bij komt. Waarden gaan als gebonden
 * parameter mee. Wat overblijft is een SELECT die alleen uit onze eigen
 * bouwstenen bestaat.
 *
 * Uitvoeren gebeurt op dezelfde read-only verbinding als de SQL-modus. Ook als
 * er ooit een fout in deze bouwer sluipt, kan een rapportage niets wijzigen.
 */
import type { DatabaseHandle } from '../../db/client.ts';
import { ENTITIES } from '../crud/registry.ts';
import { compileFilter, FilterError, type FilterNode } from './filter.ts';
import { voerLeesQuery, type SqlUitkomst } from './sql.ts';
import type { Kolom, Kolomtype } from '../export/xlsx.ts';

export class BouwerFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BouwerFout';
    this.code = code;
  }
}

/** De functies die een groepering mag gebruiken. */
export const AGGREGATIES = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type Aggregatie = (typeof AGGREGATIES)[number];

export type Bouwkolom = {
  veld: string;
  /** De kop boven de kolom. Leeg betekent: de veldnaam. */
  kop?: string;
  /** Alleen bij een groepering: welke functie eroverheen gaat. */
  aggregatie?: Aggregatie;
};

export type Bouwsortering = {
  veld: string;
  richting?: 'asc' | 'desc';
};

export type Bouwdefinitie = {
  entiteit: string;
  kolommen: Bouwkolom[];
  filter?: FilterNode | null;
  sortering?: Bouwsortering[];
  /** Velden waarop gegroepeerd wordt. Leeg betekent: geen groepering. */
  groepering?: string[];
  limiet?: number;
  /** Neem gearchiveerde records mee. Standaard niet. */
  metGearchiveerde?: boolean;
};

/** De entiteiten waar een rapportage over kan gaan, met hun kolommen. */
export function beschikbareEntiteiten(handle: DatabaseHandle): Array<{
  sleutel: string;
  tabel: string;
  kolommen: Kolom[];
}> {
  return ENTITIES.map((definitie) => ({
    sleutel: definitie.key,
    tabel: definitie.table,
    kolommen: kolommenVan(handle, definitie.table),
  }));
}

/**
 * De kolommen van een tabel, rechtstreeks uit SQLite.
 *
 * Via `table_xinfo` en niet `table_info`, want dat eerste geeft ook de
 * gegenereerde kolommen terug — en dat zijn precies de maatwerkvelden uit
 * hoofdstuk 3. Een rapportage moet daarop kunnen filteren zodra ze bestaan,
 * zonder dat er hier iets bijgehouden hoeft te worden.
 */
export function kolommenVan(handle: DatabaseHandle, tabel: string): Kolom[] {
  const rijen = handle.raw
    .prepare(`PRAGMA table_xinfo(${JSON.stringify(tabel)})`)
    .all() as Array<{ name: string; type: string; hidden: number }>;

  return rijen
    // hidden 1 is een verborgen kolom van een virtuele tabel; die willen we niet.
    .filter((rij) => rij.hidden !== 1)
    .map((rij) => ({ sleutel: rij.name, kop: rij.name, type: raadType(rij.name, rij.type) }));
}

/**
 * Raadt wat voor soort waarde er in een kolom staat, aan de naam en het type.
 *
 * Een gok, maar een goede: het hele schema houdt zich aan dezelfde afspraken
 * (bedragen in centen met `_cents`, percentages in basispunten met `_bp`).
 * Zit het ernaast, dan staat er een getal in plaats van een bedrag — hinderlijk
 * en niet erg. Het alternatief is een handmatige lijst die achterloopt.
 */
export function raadType(naam: string, sqlType: string): Kolomtype {
  if (naam.endsWith('_cents')) return 'bedrag';
  if (naam.endsWith('_bp')) return 'procent';
  if (naam.endsWith('_at') || naam.endsWith('_date') || naam === 'birthday') return 'datum';

  const type = sqlType.toUpperCase();
  if (type.includes('INT') || type.includes('REAL') || type.includes('NUM')) return 'getal';
  return 'tekst';
}

export type Gebouwd = {
  sql: string;
  params: unknown[];
  /** De kolommen zoals ze in het resultaat en de export komen. */
  kolommen: Kolom[];
};

/**
 * Zet een definitie om in SQL.
 *
 * Zuiver: geen netwerk, geen tijd, geen uitvoering. De kolomlijst komt van
 * buiten mee zodat deze functie zonder database te testen is.
 */
export function bouwSql(definitie: Bouwdefinitie, beschikbaar: Kolom[]): Gebouwd {
  const entiteit = ENTITIES.find((kandidaat) => kandidaat.key === definitie.entiteit);
  if (entiteit === undefined) {
    throw new BouwerFout(
      'onbekende_entiteit',
      `Er is geen gegevenssoort "${definitie.entiteit}".`,
    );
  }

  const opzoek = new Map(beschikbaar.map((kolom) => [kolom.sleutel, kolom]));
  const eis = (veld: string): Kolom => {
    const kolom = opzoek.get(veld);
    if (kolom === undefined) {
      throw new BouwerFout('onbekend_veld', `Het veld "${veld}" bestaat niet in deze gegevens.`);
    }
    return kolom;
  };

  if (definitie.kolommen.length === 0) {
    throw new BouwerFout('geen_kolommen', 'Kies minstens één kolom voor de rapportage.');
  }

  const groepering = definitie.groepering ?? [];
  const groepeert = groepering.length > 0;

  // Bij een groepering moet elke kolom óf gegroepeerd zijn óf een functie
  // hebben. SQLite laat het anders toe en levert dan een willekeurige rij uit
  // de groep op — een getal dat klopt maar niets betekent.
  const selecties: string[] = [];
  const uitvoerkolommen: Kolom[] = [];

  for (const kolom of definitie.kolommen) {
    const bron = eis(kolom.veld);
    const kop = kolom.kop === undefined || kolom.kop === '' ? bron.sleutel : kolom.kop;
    const alias = veiligeAlias(kop, uitvoerkolommen.length);

    if (kolom.aggregatie !== undefined) {
      if (!AGGREGATIES.includes(kolom.aggregatie)) {
        throw new BouwerFout('onbekende_functie', `De functie "${kolom.aggregatie}" bestaat niet.`);
      }
      selecties.push(`${kolom.aggregatie.toUpperCase()}(${citeer(bron.sleutel)}) AS ${citeer(alias)}`);
      uitvoerkolommen.push({
        sleutel: alias,
        kop,
        // Tellen levert altijd een geheel getal op, ook over een bedragkolom.
        type: kolom.aggregatie === 'count' ? 'getal' : bron.type,
      });
      continue;
    }

    if (groepeert && !groepering.includes(kolom.veld)) {
      throw new BouwerFout(
        'kolom_zonder_functie',
        `De kolom "${kop}" staat niet in de groepering en heeft geen functie. Groepeer erop, of kies bijvoorbeeld "aantal" of "som".`,
      );
    }

    selecties.push(`${citeer(bron.sleutel)} AS ${citeer(alias)}`);
    uitvoerkolommen.push({ sleutel: alias, kop, type: bron.type });
  }

  const params: unknown[] = [];
  const voorwaarden: string[] = [];

  // Gearchiveerde records blijven standaard buiten beeld, net als in de
  // lijstschermen. Anders telt een rapportage records mee die iedereen als
  // verwijderd beschouwt.
  if (entiteit.softDelete === true && definitie.metGearchiveerde !== true) {
    voorwaarden.push('archived_at IS NULL');
  }

  if (definitie.filter !== undefined && definitie.filter !== null) {
    try {
      const gecompileerd = compileFilter(definitie.filter, {
        resolve: (veld) => (opzoek.has(veld) ? citeer(veld) : null),
      });
      voorwaarden.push(`(${gecompileerd.sql})`);
      params.push(...gecompileerd.params);
    } catch (fout) {
      if (fout instanceof FilterError) {
        throw new BouwerFout('filter_fout', `Het filter klopt niet: ${fout.message}`);
      }
      throw fout;
    }
  }

  const sorteringen = (definitie.sortering ?? []).map((sortering) => {
    eis(sortering.veld);
    return `${citeer(sortering.veld)} ${sortering.richting === 'desc' ? 'DESC' : 'ASC'}`;
  });

  const delen = [
    `SELECT ${selecties.join(', ')}`,
    `FROM ${citeer(entiteit.table)}`,
    voorwaarden.length > 0 ? `WHERE ${voorwaarden.join(' AND ')}` : '',
    groepeert ? `GROUP BY ${groepering.map((veld) => citeer(eis(veld).sleutel)).join(', ')}` : '',
    sorteringen.length > 0 ? `ORDER BY ${sorteringen.join(', ')}` : '',
  ].filter((deel) => deel !== '');

  return { sql: delen.join('\n'), params, kolommen: uitvoerkolommen };
}

/** Zet een naam veilig tussen dubbele aanhalingstekens. */
function citeer(naam: string): string {
  return `"${naam.replace(/"/g, '""')}"`;
}

/**
 * Een alias die SQLite aankan.
 *
 * De kop mag alles bevatten wat de gebruiker intypt; als alias moet er iets
 * overblijven dat uniek is en geen aanhalingstekens bevat.
 */
function veiligeAlias(kop: string, index: number): string {
  const schoon = kop.replace(/["\n\r]/g, ' ').trim();
  return schoon === '' ? `kolom_${index + 1}` : `${schoon}`;
}

/**
 * Bouwt de query en voert hem uit, read-only.
 *
 * Geeft naast de rijen ook de kolommen terug zoals de export ze nodig heeft:
 * met kop en type, zodat een bedrag in Excel als bedrag aankomt.
 */
export function draaiBouwer(
  handle: DatabaseHandle,
  bestandspad: string,
  definitie: Bouwdefinitie,
): { uitkomst: SqlUitkomst; kolommen: Kolom[]; sql: string } {
  const entiteit = ENTITIES.find((kandidaat) => kandidaat.key === definitie.entiteit);
  if (entiteit === undefined) {
    throw new BouwerFout('onbekende_entiteit', `Er is geen gegevenssoort "${definitie.entiteit}".`);
  }

  const gebouwd = bouwSql(definitie, kolommenVan(handle, entiteit.table));
  const uitkomst = voerLeesQuery(bestandspad, gebouwd.sql, gebouwd.params, definitie.limiet);

  return { uitkomst, kolommen: gebouwd.kolommen, sql: gebouwd.sql };
}
