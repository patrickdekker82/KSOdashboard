/**
 * Een Excel-werkblad lezen (hoofdstuk 11).
 *
 * Genoeg om een planningsbestand binnen te halen, meer niet: cellen met tekst,
 * getallen, datums en booleans, uit één werkblad. Opmaak, formules,
 * draaitabellen en grafieken worden overgeslagen — van een formule lezen we de
 * uitkomst die Excel er zelf bij heeft opgeslagen, want die staat in het
 * bestand.
 *
 * Datums zijn in Excel getallen sinds 1 januari 1900, met een schrikkeldag in
 * 1900 die nooit heeft bestaan. Die fout zit in het bestandsformaat en moet dus
 * worden nagebootst, anders staat elke datum van voor maart 1900 een dag
 * verkeerd. Of een getal een datum is, blijkt uit de opmaakcode van de cel; dat
 * is de enige plek waar dat staat.
 */
import { leesInhoudsopgave, leesBestand, ZipFout } from './zip.ts';

export type CelWaarde = string | number | boolean | null;

export type Werkblad = {
  naam: string;
  /** Rijen met cellen, uitgelijnd op kolom A, B, C… Lege cellen zijn `null`. */
  rijen: CelWaarde[][];
};

export class ExcelFout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExcelFout';
  }
}

// --- XML, net genoeg -------------------------------------------------------

/** Zet de vijf XML-entiteiten terug om. */
function ontsnap(tekst: string): string {
  return tekst
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    // Als laatste, anders wordt "&amp;lt;" twee keer omgezet.
    .replace(/&amp;/g, '&');
}

/** De waarde van één attribuut uit een openingstag. */
function attribuut(tag: string, naam: string): string | null {
  const match = new RegExp(`\\s${naam}="([^"]*)"`).exec(tag);
  return match ? ontsnap(match[1] ?? '') : null;
}

/**
 * De gedeelde tekstenlijst.
 *
 * Excel schrijft elke unieke tekst één keer weg en verwijst er vanuit de cellen
 * naar met een nummer. Een tekst kan uit meerdere stukken bestaan (als er
 * halverwege een woord een andere opmaak begint); die stukken horen aan elkaar.
 */
function leesGedeeldeTeksten(xml: string): string[] {
  const teksten: string[] = [];
  const items = xml.split(/<si[\s>]/).slice(1);

  for (const item of items) {
    const einde = item.indexOf('</si>');
    const inhoud = einde === -1 ? item : item.slice(0, einde);
    let tekst = '';
    for (const stuk of inhoud.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
      tekst += ontsnap(stuk[1] ?? '');
    }
    teksten.push(tekst);
  }

  return teksten;
}

// --- datums ----------------------------------------------------------------

/**
 * Opmaakcodes die Excel standaard voor datums en tijden gebruikt.
 *
 * 14 t/m 22 zijn de ingebouwde datum- en tijdopmaken; 45 t/m 47 zijn de
 * verstreken-tijdvarianten. Alles daarboven is door de gebruiker gemaakt en
 * staat in de opmaaklijst van het bestand zelf.
 */
const INGEBOUWDE_DATUMOPMAAK = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Herkent een zelfgemaakte opmaakcode als datum aan de letters erin. */
function isDatumOpmaak(code: string): boolean {
  // Haal weg wat tussen aanhalingstekens staat: daar mag "d" gewoon in staan
  // als letter, bijvoorbeeld in het valutateken van een bedrag.
  const schoon = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(schoon) && !/^[#0.,%\s]*$/.test(schoon);
}

/** Excels dagnummer omzetten naar een ISO-datum. */
export function excelDatum(serieel: number): string {
  // Excel doet alsof 1900 een schrikkeljaar was. Dagnummer 60 is die dag die
  // niet bestaat; alles daarboven staat dus één dag te ver.
  const dagen = serieel > 59 ? serieel - 1 : serieel;
  // Dagnummer 1 is 1 januari 1900.
  const millis = Date.UTC(1900, 0, 1) + (dagen - 1) * 86_400_000;
  const datum = new Date(millis);
  const maand = String(datum.getUTCMonth() + 1).padStart(2, '0');
  const dag = String(datum.getUTCDate()).padStart(2, '0');
  return `${datum.getUTCFullYear()}-${maand}-${dag}`;
}

/** Welke opmaakcode elke stijl gebruikt, en welke daarvan een datum is. */
function leesDatumStijlen(stijlXml: string): Set<number> {
  const eigenOpmaak = new Map<number, string>();
  for (const tag of stijlXml.matchAll(/<numFmt\s[^>]*\/?>/g)) {
    const id = Number(attribuut(tag[0], 'numFmtId') ?? -1);
    const code = attribuut(tag[0], 'formatCode') ?? '';
    if (id >= 0) eigenOpmaak.set(id, code);
  }

  // Alleen het blok cellXfs telt: dat zijn de stijlen waar cellen naar wijzen.
  const blok = /<cellXfs[\s>][\s\S]*?<\/cellXfs>/.exec(stijlXml)?.[0] ?? '';
  const datumStijlen = new Set<number>();
  let index = 0;

  for (const tag of blok.matchAll(/<xf\s[^>]*\/?>/g)) {
    const opmaakId = Number(attribuut(tag[0], 'numFmtId') ?? 0);
    const eigen = eigenOpmaak.get(opmaakId);
    if (INGEBOUWDE_DATUMOPMAAK.has(opmaakId) || (eigen !== undefined && isDatumOpmaak(eigen))) {
      datumStijlen.add(index);
    }
    index += 1;
  }

  return datumStijlen;
}

// --- celverwijzingen -------------------------------------------------------

/** "C7" → kolom 2 (nulgebaseerd). Geeft `null` bij een onleesbare verwijzing. */
export function kolomVan(verwijzing: string): number | null {
  const letters = /^([A-Z]+)/.exec(verwijzing.toUpperCase())?.[1];
  if (!letters) return null;
  let kolom = 0;
  for (const letter of letters) kolom = kolom * 26 + (letter.charCodeAt(0) - 64);
  return kolom - 1;
}

// --- het werkblad ----------------------------------------------------------

/**
 * Leest het eerste werkblad van een .xlsx.
 *
 * Een planningsbestand heeft in de praktijk één tabblad; is er meer, dan wint
 * het eerste. Welk blad dat is, staat in de werkmapverwijzingen en niet in de
 * bestandsnamen — `sheet1.xml` hoeft niet het eerste tabblad te zijn.
 */
export function leesWerkblad(bestand: Buffer, bladNaam?: string): Werkblad {
  let onderdelen;
  try {
    onderdelen = leesInhoudsopgave(bestand);
  } catch (error) {
    if (error instanceof ZipFout) {
      throw new ExcelFout(
        `Dit lijkt geen Excel-bestand te zijn. ${error.message} Een .xls van voor 2007 werkt niet; ` +
          'sla hem in Excel opnieuw op als .xlsx.',
      );
    }
    throw error;
  }

  const haal = (naam: string): string | null => {
    const item = onderdelen.find((entry) => entry.naam === naam);
    return item ? leesBestand(bestand, item).toString('utf8') : null;
  };

  const werkmap = haal('xl/workbook.xml');
  if (!werkmap) throw new ExcelFout('In dit bestand zit geen werkmap. Is het wel een .xlsx?');

  const relaties = haal('xl/_rels/workbook.xml.rels') ?? '';
  const bladen = [...werkmap.matchAll(/<sheet\s[^>]*\/?>/g)].map((tag) => ({
    naam: attribuut(tag[0], 'name') ?? '',
    relatie: attribuut(tag[0], 'r:id') ?? attribuut(tag[0], 'id') ?? '',
  }));

  if (bladen.length === 0) throw new ExcelFout('Deze werkmap heeft geen tabbladen.');

  const gekozen =
    bladNaam === undefined
      ? bladen[0]!
      : (bladen.find((blad) => blad.naam === bladNaam) ??
        (() => {
          throw new ExcelFout(
            `Er is geen tabblad "${bladNaam}". Dit bestand heeft: ${bladen.map((b) => b.naam).join(', ')}.`,
          );
        })());

  const doel = new RegExp(`<Relationship[^>]*Id="${gekozen.relatie}"[^>]*>`).exec(relaties)?.[0];
  const pad = doel ? attribuut(doel, 'Target') : null;
  const bladPad = pad
    ? `xl/${pad.replace(/^\/?xl\//, '').replace(/^\//, '')}`
    : 'xl/worksheets/sheet1.xml';

  const bladXml = haal(bladPad) ?? haal('xl/worksheets/sheet1.xml');
  if (!bladXml) throw new ExcelFout(`Het tabblad "${gekozen.naam}" kon niet worden gelezen.`);

  const teksten = leesGedeeldeTeksten(haal('xl/sharedStrings.xml') ?? '');
  const datumStijlen = leesDatumStijlen(haal('xl/styles.xml') ?? '');

  return { naam: gekozen.naam, rijen: leesRijen(bladXml, teksten, datumStijlen) };
}

function leesRijen(
  bladXml: string,
  teksten: string[],
  datumStijlen: ReadonlySet<number>,
): CelWaarde[][] {
  const rijen: CelWaarde[][] = [];

  for (const rijTag of bladXml.matchAll(/<row[\s>][\s\S]*?(?:<\/row>|\/>)/g)) {
    const rijXml = rijTag[0];
    const cellen: CelWaarde[] = [];

    for (const celTag of rijXml.matchAll(/<c[\s>]([\s\S]*?)(?:<\/c>|\/>)/g)) {
      const heel = celTag[0];
      const kop = /^<c[^>]*>/.exec(heel)?.[0] ?? heel;
      const verwijzing = attribuut(kop, 'r');
      const soort = attribuut(kop, 't') ?? 'n';
      const stijl = Number(attribuut(kop, 's') ?? -1);

      const kolom = verwijzing ? kolomVan(verwijzing) : null;
      const index = kolom ?? cellen.length;
      while (cellen.length < index) cellen.push(null);

      cellen[index] = celWaarde(heel, soort, stijl, teksten, datumStijlen);
    }

    rijen.push(cellen);
  }

  return rijen;
}

function celWaarde(
  celXml: string,
  soort: string,
  stijl: number,
  teksten: string[],
  datumStijlen: ReadonlySet<number>,
): CelWaarde {
  // Een cel met tekst erin ("inline string") heeft geen <v> maar <is><t>.
  if (soort === 'inlineStr') {
    let tekst = '';
    for (const stuk of celXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) tekst += ontsnap(stuk[1] ?? '');
    return tekst === '' ? null : tekst;
  }

  const ruw = /<v[^>]*>([\s\S]*?)<\/v>/.exec(celXml)?.[1];
  if (ruw === undefined) return null;
  const waarde = ontsnap(ruw);

  if (soort === 's') {
    const nummer = Number(waarde);
    return teksten[nummer] ?? null;
  }
  if (soort === 'str') return waarde === '' ? null : waarde;
  if (soort === 'b') return waarde === '1';
  // Een fout in de cel (#N/B, #DEEL/0!) geven we terug als tekst; de
  // kolomcontrole verderop maakt er een nette rijfout van.
  if (soort === 'e') return waarde;

  const getal = Number(waarde);
  if (!Number.isFinite(getal)) return waarde === '' ? null : waarde;
  // Nul is in Excel 0 januari 1900 en dus geen datum die iemand bedoelt.
  if (datumStijlen.has(stijl) && getal > 0) return excelDatum(getal);
  return getal;
}
