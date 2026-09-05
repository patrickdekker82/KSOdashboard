/**
 * Een zip-bestand schrijven (hoofdstuk 11).
 *
 * De tegenhanger van `modules/import/zip.ts`. Zowel .xlsx als .docx zijn een
 * zip met XML erin, dus met deze ene schrijver eronder kunnen beide zonder
 * externe bibliotheek. `zlib.deflateRawSync` doet het zware deel.
 *
 * Wat deze schrijver bewust niet doet: zip64, versleuteling, mappen als aparte
 * items. Een rapportage van een paar duizend rijen komt in geen van die
 * gevallen. De grens van 65.535 bestanden en 4 GB per bestand wordt bewaakt en
 * levert een leesbare fout op in plaats van een stilzwijgend kapot archief.
 */
import { deflateRawSync } from 'node:zlib';

export class ZipSchrijfFout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipSchrijfFout';
  }
}

export type ZipInvoer = {
  /** Pad binnen het archief, met schuine strepen: `xl/worksheets/sheet1.xml`. */
  naam: string;
  inhoud: Buffer | string;
  /**
   * Sommige onderdelen moeten onverpakt blijven. `[Content_Types].xml` mag van
   * de meeste lezers wel gedeflate worden, maar niet elke lezer is even mild,
   * en het bestandje is toch klein.
   */
  bewaarOnverpakt?: boolean;
};

/** De handtekeningen, gespiegeld aan de lezer. */
const LOKALE_KOP = 0x04034b50;
const CENTRALE_KOP = 0x02014b50;
const EINDE_KOP = 0x06054b50;

const MAX_ITEMS = 0xffff;
const MAX_BYTES = 0xffffffff;

/**
 * CRC-32, zoals zip hem wil.
 *
 * De tabel wordt één keer opgebouwd en daarna hergebruikt; zonder tabel is dit
 * bij een werkmap van enkele megabytes merkbaar traag.
 */
const CRC_TABEL = ((): Uint32Array => {
  const tabel = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let waarde = i;
    for (let bit = 0; bit < 8; bit += 1) {
      waarde = (waarde & 1) === 1 ? 0xedb88320 ^ (waarde >>> 1) : waarde >>> 1;
    }
    tabel[i] = waarde >>> 0;
  }
  return tabel;
})();

export function crc32(buffer: Buffer): number {
  let rest = 0xffffffff;
  for (const byte of buffer) {
    rest = CRC_TABEL[(rest ^ byte) & 0xff]! ^ (rest >>> 8);
  }
  return (rest ^ 0xffffffff) >>> 0;
}

/**
 * Datum en tijd in het MS-DOS-formaat dat zip gebruikt.
 *
 * Er wordt bewust een vaste datum gebruikt en niet `new Date()`: dan levert
 * dezelfde rapportage tweemaal exact hetzelfde bestand op, en dat maakt de
 * tests zinnig. De datum in het archief zegt niets; Windows toont die van het
 * bestand zelf.
 */
const DOS_DATUM = ((1980 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIJD = 0;

type Voorbereid = {
  naam: Buffer;
  data: Buffer;
  ingepakt: Buffer;
  crc: number;
  methode: number;
  offset: number;
};

/** Maakt één zip-archief van de opgegeven bestanden. */
export function maakZip(invoer: ZipInvoer[]): Buffer {
  if (invoer.length > MAX_ITEMS) {
    throw new ZipSchrijfFout(
      `Een zip-bestand kan hier maximaal ${MAX_ITEMS} onderdelen bevatten, niet ${invoer.length}.`,
    );
  }

  const namen = new Set<string>();
  const items: Voorbereid[] = [];
  const stukken: Buffer[] = [];
  let offset = 0;

  for (const bestand of invoer) {
    if (namen.has(bestand.naam)) {
      throw new ZipSchrijfFout(`Het onderdeel "${bestand.naam}" zit er tweemaal in.`);
    }
    namen.add(bestand.naam);

    const naam = Buffer.from(bestand.naam, 'utf8');
    const data = Buffer.isBuffer(bestand.inhoud)
      ? bestand.inhoud
      : Buffer.from(bestand.inhoud, 'utf8');

    if (data.length > MAX_BYTES) {
      throw new ZipSchrijfFout(`Het onderdeel "${bestand.naam}" is te groot voor een gewone zip.`);
    }

    const ingepakt = bestand.bewaarOnverpakt === true ? data : deflateRawSync(data, { level: 6 });
    const methode = bestand.bewaarOnverpakt === true ? 0 : 8;

    const kop = Buffer.alloc(30);
    kop.writeUInt32LE(LOKALE_KOP, 0);
    kop.writeUInt16LE(20, 4); // benodigde versie: 2.0
    kop.writeUInt16LE(0x0800, 6); // vlag: namen zijn UTF-8
    kop.writeUInt16LE(methode, 8);
    kop.writeUInt16LE(DOS_TIJD, 10);
    kop.writeUInt16LE(DOS_DATUM, 12);
    const controle = crc32(data);
    kop.writeUInt32LE(controle, 14);
    kop.writeUInt32LE(ingepakt.length, 18);
    kop.writeUInt32LE(data.length, 22);
    kop.writeUInt16LE(naam.length, 26);
    kop.writeUInt16LE(0, 28); // geen extra veld

    items.push({ naam, data, ingepakt, crc: controle, methode, offset });
    stukken.push(kop, naam, ingepakt);
    offset += kop.length + naam.length + ingepakt.length;
  }

  const centraleStart = offset;

  for (const item of items) {
    const kop = Buffer.alloc(46);
    kop.writeUInt32LE(CENTRALE_KOP, 0);
    kop.writeUInt16LE(20, 4); // gemaakt door versie 2.0
    kop.writeUInt16LE(20, 6); // benodigde versie
    kop.writeUInt16LE(0x0800, 8);
    kop.writeUInt16LE(item.methode, 10);
    kop.writeUInt16LE(DOS_TIJD, 12);
    kop.writeUInt16LE(DOS_DATUM, 14);
    kop.writeUInt32LE(item.crc, 16);
    kop.writeUInt32LE(item.ingepakt.length, 20);
    kop.writeUInt32LE(item.data.length, 24);
    kop.writeUInt16LE(item.naam.length, 28);
    kop.writeUInt16LE(0, 30); // extra veld
    kop.writeUInt16LE(0, 32); // commentaar
    kop.writeUInt16LE(0, 34); // schijfnummer
    kop.writeUInt16LE(0, 36); // interne attributen
    kop.writeUInt32LE(0, 38); // externe attributen
    kop.writeUInt32LE(item.offset, 42);

    stukken.push(kop, item.naam);
    offset += kop.length + item.naam.length;
  }

  const einde = Buffer.alloc(22);
  einde.writeUInt32LE(EINDE_KOP, 0);
  einde.writeUInt16LE(0, 4); // schijfnummer
  einde.writeUInt16LE(0, 6); // schijf met de centrale directory
  einde.writeUInt16LE(items.length, 8);
  einde.writeUInt16LE(items.length, 10);
  einde.writeUInt32LE(offset - centraleStart, 12);
  einde.writeUInt32LE(centraleStart, 16);
  einde.writeUInt16LE(0, 20); // geen commentaar
  stukken.push(einde);

  return Buffer.concat(stukken);
}
