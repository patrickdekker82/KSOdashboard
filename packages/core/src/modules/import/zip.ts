/**
 * Een zip-bestand uitpakken, alleen wat nodig is om een .xlsx te lezen.
 *
 * Een .xlsx is een zip met XML erin. Er is geen zip-lezer in Node, en een
 * externe bibliotheek wilden we hier niet: de applicatie heeft nul
 * runtime-afhankelijkheden en dat is een van de redenen dat de installatie op
 * elke werkplek hetzelfde doet. Uitpakken zelf is overzichtelijk werk —
 * `zlib.inflateRawSync` doet het zware deel.
 *
 * Wat deze lezer bewust niet kan:
 *
 *   - zip64 (meer dan 65.535 bestanden of groter dan 4 GB)
 *   - versleutelde archieven
 *   - andere compressie dan "opgeslagen" (0) en "deflate" (8)
 *
 * Een werkmap uit Excel of LibreOffice valt in geen van die gevallen. Komt er
 * toch zoiets binnen, dan zegt de foutmelding wát er niet kan in plaats van
 * halve gegevens terug te geven.
 */
import { inflateRawSync } from 'node:zlib';

/** De handtekening van de centrale directory: "PK\x01\x02". */
const CENTRALE_KOP = 0x02014b50;
/** De handtekening van het einde van de centrale directory: "PK\x05\x06". */
const EINDE_KOP = 0x06054b50;
/** De handtekening van een lokale bestandskop: "PK\x03\x04". */
const LOKALE_KOP = 0x04034b50;

export class ZipFout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFout';
  }
}

export type ZipItem = {
  naam: string;
  /** Waar de lokale kop van dit bestand begint. */
  offset: number;
  compressie: number;
  ingepakt: number;
  uitgepakt: number;
};

/**
 * Zoekt het einde van de centrale directory.
 *
 * Dat blok staat achteraan, maar er kan een commentaar achter staan van maximaal
 * 65.535 bytes. Daarom van achteren naar voren zoeken in plaats van een vaste
 * plek aannemen.
 */
function vindEinde(buffer: Buffer): number {
  const minimaal = Math.max(0, buffer.length - 22 - 0xffff);
  for (let index = buffer.length - 22; index >= minimaal; index -= 1) {
    if (buffer.readUInt32LE(index) === EINDE_KOP) return index;
  }
  throw new ZipFout('Dit is geen geldig zip-bestand: het einde van de inhoudsopgave ontbreekt.');
}

/** De inhoudsopgave van het archief. */
export function leesInhoudsopgave(buffer: Buffer): ZipItem[] {
  const einde = vindEinde(buffer);
  const aantal = buffer.readUInt16LE(einde + 10);
  const startCentraal = buffer.readUInt32LE(einde + 16);

  // 0xffffffff op deze plek betekent zip64, en dat lezen we niet.
  if (startCentraal === 0xffffffff || aantal === 0xffff) {
    throw new ZipFout('Dit bestand gebruikt zip64. Sla het opnieuw op als gewone .xlsx.');
  }

  const items: ZipItem[] = [];
  let positie = startCentraal;

  for (let index = 0; index < aantal; index += 1) {
    if (positie + 46 > buffer.length || buffer.readUInt32LE(positie) !== CENTRALE_KOP) {
      throw new ZipFout('De inhoudsopgave van het zip-bestand is beschadigd.');
    }

    const vlaggen = buffer.readUInt16LE(positie + 8);
    // Bit 0 is de versleutelingsvlag.
    if ((vlaggen & 0x0001) !== 0) {
      throw new ZipFout('Dit bestand is met een wachtwoord beveiligd en kan niet worden gelezen.');
    }

    const compressie = buffer.readUInt16LE(positie + 10);
    const ingepakt = buffer.readUInt32LE(positie + 20);
    const uitgepakt = buffer.readUInt32LE(positie + 24);
    const naamLengte = buffer.readUInt16LE(positie + 28);
    const extraLengte = buffer.readUInt16LE(positie + 30);
    const commentaarLengte = buffer.readUInt16LE(positie + 32);
    const offset = buffer.readUInt32LE(positie + 42);

    items.push({
      naam: buffer.subarray(positie + 46, positie + 46 + naamLengte).toString('utf8'),
      offset,
      compressie,
      ingepakt,
      uitgepakt,
    });

    positie += 46 + naamLengte + extraLengte + commentaarLengte;
  }

  return items;
}

/** Pakt één bestand uit het archief uit. */
export function leesBestand(buffer: Buffer, item: ZipItem): Buffer {
  if (item.offset + 30 > buffer.length || buffer.readUInt32LE(item.offset) !== LOKALE_KOP) {
    throw new ZipFout(`Het onderdeel "${item.naam}" staat niet op de plek die de inhoudsopgave noemt.`);
  }

  // De lengtes in de lokale kop kunnen afwijken van die in de centrale
  // directory; voor het overslaan van de kop tellen deze.
  const naamLengte = buffer.readUInt16LE(item.offset + 26);
  const extraLengte = buffer.readUInt16LE(item.offset + 28);
  const start = item.offset + 30 + naamLengte + extraLengte;
  const inhoud = buffer.subarray(start, start + item.ingepakt);

  if (item.compressie === 0) return Buffer.from(inhoud);
  if (item.compressie === 8) return inflateRawSync(inhoud);

  throw new ZipFout(
    `Het onderdeel "${item.naam}" gebruikt een compressiemethode die deze lezer niet kent (${item.compressie}).`,
  );
}

/** Pakt één bestand op naam uit; `null` als het er niet in zit. */
export function leesOpNaam(buffer: Buffer, naam: string): Buffer | null {
  const item = leesInhoudsopgave(buffer).find((entry) => entry.naam === naam);
  return item ? leesBestand(buffer, item) : null;
}
