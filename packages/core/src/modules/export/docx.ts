/**
 * Een .docx schrijven (hoofdstuk 11).
 *
 * Ook een docx is een zip met XML erin, dus hij past op dezelfde zip-schrijver
 * als de werkmap. Zelf geschreven en niet met docxtemplater: de image-, html-
 * en xlsx-modules daarvan zijn betaald en de opdracht sluit betaalde pakketten
 * uit. Wat hier nodig is — een kop, wat alinea's en een tabel — is een klein
 * stuk WordprocessingML.
 *
 * Wat er niet in zit: afbeeldingen, kop- en voetteksten, stijlen die de
 * gebruiker zelf kan kiezen. Wie een briefpapier-sjabloon wil, exporteert naar
 * Word en plakt het daar in.
 */
import { maakZip, type ZipInvoer } from './zip.ts';
import { escapeXml, type Kolom } from './xlsx.ts';

export type Document = {
  titel: string;
  /** Regels onder de titel: datum, wie het maakte, welke filters erop staan. */
  ondertitels?: string[];
  kolommen: Kolom[];
  rijen: Array<Record<string, unknown>>;
  /** Een slotregel, bijvoorbeeld het aantal rijen. */
  voetnoot?: string | null;
};

/** Een alinea met een stijl. */
function alinea(tekst: string, stijl?: string): string {
  const opmaak = stijl === undefined ? '' : `<w:pPr><w:pStyle w:val="${stijl}"/></w:pPr>`;
  return `<w:p>${opmaak}<w:r><w:t xml:space="preserve">${escapeXml(tekst)}</w:t></w:r></w:p>`;
}

/** Een cel in de tabel. `vet` maakt er een kopcel van. */
function tabelcel(tekst: string, vet: boolean): string {
  const tekens = vet ? '<w:rPr><w:b/></w:rPr>' : '';
  const arcering = vet
    ? '<w:shd w:val="clear" w:color="auto" w:fill="EFEFEF"/>'
    : '';
  return (
    `<w:tc><w:tcPr>${arcering}</w:tcPr>` +
    `<w:p><w:r>${tekens}<w:t xml:space="preserve">${escapeXml(tekst)}</w:t></w:r></w:p></w:tc>`
  );
}

/**
 * Zet een waarde om naar de tekst die in het document komt.
 *
 * Anders dan bij de werkmap is een docx geen rekenblad: alles is tekst, en dan
 * kun je hem maar beter meteen Nederlands opmaken. Bedragen met een euroteken,
 * datums als dd-MM-yyyy, percentages met een procentteken.
 */
export function toonWaarde(waarde: unknown, type: Kolom['type']): string {
  if (waarde === null || waarde === undefined) return '';

  if (type === 'bedrag') {
    const centen = Number(waarde);
    if (Number.isFinite(centen)) {
      return (centen / 100).toLocaleString('nl-NL', {
        style: 'currency',
        currency: 'EUR',
      });
    }
  }

  if (type === 'procent') {
    const punten = Number(waarde);
    if (Number.isFinite(punten)) {
      return `${(punten / 100).toLocaleString('nl-NL')}%`;
    }
  }

  if (type === 'datum') {
    const treffer = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(waarde));
    if (treffer !== null) return `${treffer[3]}-${treffer[2]}-${treffer[1]}`;
  }

  if (type === 'getal') {
    const getal = Number(waarde);
    if (Number.isFinite(getal)) return getal.toLocaleString('nl-NL');
  }

  return String(waarde);
}

const STIJLEN = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Titel">
<w:name w:val="Title"/><w:pPr><w:spacing w:after="120"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Onderschrift">
<w:name w:val="Subtitle"/><w:pPr><w:spacing w:after="60"/></w:pPr>
<w:rPr><w:color w:val="595959"/><w:sz w:val="18"/></w:rPr>
</w:style>
</w:styles>`;

/** Bouwt het document. */
export function maakDocument(document: Document): Buffer {
  const kolommen = document.kolommen;

  const kop = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${kolommen
    .map((kolom) => tabelcel(kolom.kop, true))
    .join('')}</w:tr>`;

  const rijen = document.rijen
    .map(
      (rij) =>
        `<w:tr>${kolommen
          .map((kolom) => tabelcel(toonWaarde(rij[kolom.sleutel], kolom.type), false))
          .join('')}</w:tr>`,
    )
    .join('');

  // Liggend bij meer dan zes kolommen: anders staat de tabel op een A4 in
  // portret zo smal dat er niets meer van te lezen valt.
  const liggend = kolommen.length > 6;
  const breedte = liggend ? 16838 : 11906;
  const hoogte = liggend ? 11906 : 16838;
  const richting = liggend ? ' w:orient="landscape"' : '';

  const tabel =
    kolommen.length === 0
      ? alinea('Deze rapportage heeft geen kolommen.')
      : `<w:tbl><w:tblPr>
<w:tblStyle w:val="TableGrid"/>
<w:tblW w:w="5000" w:type="pct"/>
<w:tblBorders>
<w:top w:val="single" w:sz="4" w:color="BFBFBF"/>
<w:left w:val="single" w:sz="4" w:color="BFBFBF"/>
<w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/>
<w:right w:val="single" w:sz="4" w:color="BFBFBF"/>
<w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/>
<w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>
</w:tblBorders>
</w:tblPr>${kop}${rijen}</w:tbl>`;

  const body =
    alinea(document.titel, 'Titel') +
    (document.ondertitels ?? []).map((regel) => alinea(regel, 'Onderschrift')).join('') +
    alinea('') +
    tabel +
    (document.voetnoot === null || document.voetnoot === undefined
      ? ''
      : alinea('') + alinea(document.voetnoot, 'Onderschrift'));

  const hoofddocument = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}
<w:sectPr><w:pgSz w:w="${breedte}" w:h="${hoogte}"${richting}/>
<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709"/>
</w:sectPr>
</w:body></w:document>`;

  const bestanden: ZipInvoer[] = [
    {
      naam: '[Content_Types].xml',
      bewaarOnverpakt: true,
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
    },
    {
      naam: '_rels/.rels',
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    },
    {
      naam: 'word/_rels/document.xml.rels',
      inhoud: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { naam: 'word/document.xml', inhoud: hoofddocument },
    { naam: 'word/styles.xml', inhoud: STIJLEN },
  ];

  return maakZip(bestanden);
}
