/**
 * Een .xlsx schrijven (hoofdstuk 11).
 *
 * De tegenhanger van de lezer in `modules/import/xlsx.ts`, en om dezelfde
 * reden zelfgeschreven: de betaalde modules van docxtemplater zijn uitgesloten
 * en een werkmap maken is overzichtelijk werk zodra de zip-schrijver er staat.
 *
 * Wat er wel in zit, omdat het in de praktijk het verschil maakt tussen een
 * bestand dat je kunt gebruiken en een bestand dat je nog moet opmaken:
 *
 *   - getallen als getal, datums als datum, bedragen met een euro-opmaak
 *   - een kopregel die vastgezet is, zodat scrollen werkt
 *   - een automatisch filter over de kopregel
 *   - kolombreedtes op basis van de inhoud
 *
 * Wat er bewust niet in zit: formules, meerdere bladen, opmaakregels,
 * grafieken. Wie dat wil, exporteert en werkt verder in Excel.
 */
import { maakZip, type ZipInvoer } from './zip.ts';

export type Kolomtype = 'tekst' | 'getal' | 'bedrag' | 'datum' | 'procent';

export type Kolom = {
  sleutel: string;
  kop: string;
  type?: Kolomtype;
};

export type Blad = {
  naam: string;
  kolommen: Kolom[];
  rijen: Array<Record<string, unknown>>;
};

/**
 * Zet tekst veilig in XML.
 *
 * Stuurtekens gaan eruit: Excel weigert een werkmap waar ze in staan, en dan
 * krijgt de gebruiker "het bestand is beschadigd" te zien bij een export die
 * verder gewoon klopt. Ze weglaten is beter dan een bestand dat niet opengaat.
 */
export function escapeXml(waarde: string): string {
  return waarde
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // eslint-disable-next-line no-control-regex -- juist die tekens moeten weg
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** `0` wordt `A`, `26` wordt `AA`. Excel telt kolommen in letters. */
export function kolomletter(index: number): string {
  let rest = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (rest % 26)) + letters;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);
  return letters;
}

/**
 * Een datum als serienummer sinds 1899-12-30.
 *
 * Die datum en niet 1900-01-01, vanwege de schrikkeljaarfout van 1900 die
 * Excel om historische redenen nog steeds heeft. De lezer doet dezelfde
 * correctie de andere kant op.
 */
export function datumnummer(datum: Date): number {
  const basis = Date.UTC(1899, 11, 30);
  const dag = Date.UTC(datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate());
  return Math.round((dag - basis) / 86_400_000);
}

/** Leest een `YYYY-MM-DD` of ISO-tijdstempel als datum. `null` bij iets anders. */
function alsDatum(waarde: unknown): Date | null {
  if (waarde instanceof Date) return Number.isNaN(waarde.getTime()) ? null : waarde;
  if (typeof waarde !== 'string') return null;

  const treffer = /^(\d{4})-(\d{2})-(\d{2})/.exec(waarde.trim());
  if (treffer === null) return null;

  const datum = new Date(Date.UTC(Number(treffer[1]), Number(treffer[2]) - 1, Number(treffer[3])));
  return Number.isNaN(datum.getTime()) ? null : datum;
}

/**
 * De opmaakprofielen. De volgorde bepaalt het `s`-nummer in een cel:
 * 0 gewoon, 1 kopregel, 2 datum, 3 bedrag in euro's, 4 procent.
 */
const STIJLEN = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
<numFmt numFmtId="164" formatCode="&quot;€&quot;\\ #,##0.00"/>
<numFmt numFmtId="165" formatCode="dd-mm-yyyy"/>
</numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Een bladnaam die Excel accepteert: maximaal 31 tekens, zonder `[]:*?/\`. */
export function veiligeBladnaam(naam: string): string {
  const schoon = naam.replace(/[[\]:*?/\\]/g, ' ').trim();
  return (schoon === '' ? 'Blad1' : schoon).slice(0, 31);
}

/** Bouwt een cel. */
function cel(
  verwijzing: string,
  waarde: unknown,
  type: Kolomtype,
  gedeeldeTekst: (tekst: string) => number,
): string {
  if (waarde === null || waarde === undefined || waarde === '') {
    return `<c r="${verwijzing}"/>`;
  }

  if (type === 'datum') {
    const datum = alsDatum(waarde);
    if (datum !== null) return `<c r="${verwijzing}" s="2"><v>${datumnummer(datum)}</v></c>`;
  }

  if (type === 'bedrag') {
    // Bedragen staan in de database in hele centen. In Excel horen ze als
    // euro's te staan, anders klopt elke som die de gebruiker eronder zet niet.
    const centen = Number(waarde);
    if (Number.isFinite(centen)) return `<c r="${verwijzing}" s="3"><v>${centen / 100}</v></c>`;
  }

  if (type === 'procent') {
    // Basispunten (0 tot 10000) naar een fractie: 2500 bp = 25% = 0,25.
    const punten = Number(waarde);
    if (Number.isFinite(punten)) return `<c r="${verwijzing}" s="4"><v>${punten / 10000}</v></c>`;
  }

  if (type === 'getal') {
    const getal = Number(waarde);
    if (Number.isFinite(getal)) return `<c r="${verwijzing}"><v>${getal}</v></c>`;
  }

  if (typeof waarde === 'boolean') {
    return `<c r="${verwijzing}" t="b"><v>${waarde ? 1 : 0}</v></c>`;
  }

  return `<c r="${verwijzing}" t="s"><v>${gedeeldeTekst(String(waarde))}</v></c>`;
}

/** Schat een bruikbare kolombreedte uit de kop en de eerste rijen. */
function breedte(kolom: Kolom, rijen: Array<Record<string, unknown>>): number {
  let langste = kolom.kop.length;
  for (const rij of rijen.slice(0, 200)) {
    const waarde = rij[kolom.sleutel];
    if (waarde === null || waarde === undefined) continue;
    langste = Math.max(langste, String(waarde).length);
  }
  return Math.min(Math.max(langste + 2, 9), 60);
}

/**
 * Maakt een werkmap met een blad.
 *
 * Een blad, want een rapportage is een tabel. Wie meerdere tabellen naast
 * elkaar wil, exporteert tweemaal; dat is duidelijker dan een bladenstructuur
 * die niemand kan uitleggen.
 */
export function maakWerkmap(blad: Blad): Buffer {
  const tekstIndex = new Map<string, number>();
  const teksten: string[] = [];
  const gedeeldeTekst = (tekst: string): number => {
    const bestaand = tekstIndex.get(tekst);
    if (bestaand !== undefined) return bestaand;
    const index = teksten.length;
    tekstIndex.set(tekst, index);
    teksten.push(tekst);
    return index;
  };

  const kolommen = blad.kolommen;
  const laatsteKolom = kolomletter(Math.max(kolommen.length - 1, 0));

  const kopRij = kolommen
    .map(
      (kolom, index) =>
        `<c r="${kolomletter(index)}1" s="1" t="s"><v>${gedeeldeTekst(kolom.kop)}</v></c>`,
    )
    .join('');

  const rijen = blad.rijen
    .map((rij, rijIndex) => {
      const nummer = rijIndex + 2;
      const cellen = kolommen
        .map((kolom, index) =>
          cel(
            `${kolomletter(index)}${nummer}`,
            rij[kolom.sleutel],
            kolom.type ?? 'tekst',
            gedeeldeTekst,
          ),
        )
        .join('');
      return `<row r="${nummer}">${cellen}</row>`;
    })
    .join('');

  const kolomBreedtes = kolommen
    .map(
      (kolom, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${breedte(kolom, blad.rijen)}" customWidth="1"/>`,
    )
    .join('');

  const laatsteRij = blad.rijen.length + 1;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${kolomBreedtes}</cols>
<sheetData><row r="1">${kopRij}</row>${rijen}</sheetData>
<autoFilter ref="A1:${laatsteKolom}${laatsteRij}"/>
</worksheet>`;

  const gedeeld = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${teksten.length}" uniqueCount="${teksten.length}">${teksten
    .map((tekst) => `<si><t xml:space="preserve">${escapeXml(tekst)}</t></si>`)
    .join('')}</sst>`;

  const naam = veiligeBladnaam(blad.naam);

  const bestanden: ZipInvoer[] = [
    {
      naam: '[Content_Types].xml',
      bewaarOnverpakt: true,
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      naam: '_rels/.rels',
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      naam: 'xl/workbook.xml',
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(naam)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      naam: 'xl/_rels/workbook.xml.rels',
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { naam: 'xl/worksheets/sheet1.xml', inhoud: sheet },
    { naam: 'xl/sharedStrings.xml', inhoud: gedeeld },
    { naam: 'xl/styles.xml', inhoud: STIJLEN },
  ];

  return maakZip(bestanden);
}
