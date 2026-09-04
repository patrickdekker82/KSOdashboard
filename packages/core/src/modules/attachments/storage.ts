/**
 * Opslag van bijlagen (hoofdstuk 10).
 *
 * Vier regels, en ze zijn geen van alle onderhandelbaar:
 *
 *   1. maximaal 25 MB per bestand
 *   2. alleen extensies uit de whitelist
 *   3. de naam op schijf wordt door ons gegenereerd, nooit door de gebruiker
 *   4. het resultaat ligt altijd binnen de bijlagenmap
 *
 * Regel 3 en 4 horen bij elkaar. Een bestandsnaam uit een upload is invoer:
 * hij kan `../../config.json` zijn, of tweehonderd tekens lang, of stuurtekens
 * bevatten die een downloadkop breken. Door zelf een naam te maken en daarna te
 * controleren dat het pad binnen de map valt, kan geen van die dingen kwaad.
 */
import { randomBytes } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export class BijlageFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BijlageFout';
    this.code = code;
  }
}

export const MAX_BIJLAGE_BYTES = 25 * 1024 * 1024;

/** Extensies die zijn toegestaan, met het mimetype dat we teruggeven. */
export const TOEGESTANE_EXTENSIES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  rtf: 'application/rtf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  zip: 'application/zip',
  eml: 'message/rfc822',
  msg: 'application/vnd.ms-outlook',
  dwg: 'image/vnd.dwg',
  dxf: 'image/vnd.dxf',
};

/**
 * SVG staat er bewust NIET bij.
 *
 * Een SVG is een document dat scripts mag bevatten. Zodra het via het
 * downloadendpoint met zijn eigen mimetype terugkomt en iemand opent het in een
 * browser, draait dat script. De andere afbeeldingsformaten kunnen dat niet.
 */

/** De extensie in kleine letters, zonder punt. */
export function extensieVan(bestandsnaam: string): string {
  const laatste = bestandsnaam.lastIndexOf('.');
  if (laatste <= 0 || laatste === bestandsnaam.length - 1) return '';
  return bestandsnaam.slice(laatste + 1).toLowerCase();
}

/**
 * Stuurtekens: breken een Content-Disposition-kop en horen nergens in een naam.
 *
 * De regel no-control-regex waarschuwt dat een stuurteken in een expressie
 * meestal een vergissing is. Hier is het het doel: dit patroon bestaat juist om
 * die tekens eruit te halen. Geschreven als escapes, zodat er geen onzichtbare
 * tekens in de broncode staan.
 */
// eslint-disable-next-line no-control-regex
const STUURTEKENS = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');

/**
 * Maakt de naam die de gebruiker te zien krijgt onschadelijk.
 *
 * Dit is niet de naam op schijf — die genereren we — maar hij komt wel in de
 * database en in downloadkoppen terecht.
 */
export function veiligeToonNaam(bestandsnaam: string): string {
  const zonderPad = bestandsnaam.split(/[\\/]/).pop() ?? 'bijlage';
  const opgeschoond = zonderPad
    .replace(STUURTEKENS, ' ')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return opgeschoond === '' || opgeschoond === '.' || opgeschoond === '..'
    ? 'bijlage'
    : opgeschoond;
}

/** Controleert extensie en grootte. Gooit een `BijlageFout` met uitleg. */
export function controleerBijlage(bestandsnaam: string, bytes: number): string {
  const extensie = extensieVan(bestandsnaam);

  if (extensie === '') {
    throw new BijlageFout(
      'geen_extensie',
      'Dit bestand heeft geen extensie, dus we kunnen niet vaststellen wat het is.',
    );
  }
  if (!Object.hasOwn(TOEGESTANE_EXTENSIES, extensie)) {
    throw new BijlageFout(
      'extensie_niet_toegestaan',
      `Bestanden van het type ".${extensie}" worden niet geaccepteerd. ` +
        'Toegestaan zijn onder andere pdf, docx, xlsx, jpg, png en zip.',
    );
  }
  if (bytes <= 0) {
    throw new BijlageFout('leeg_bestand', 'Dit bestand is leeg.');
  }
  if (bytes > MAX_BIJLAGE_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    throw new BijlageFout(
      'te_groot',
      `Dit bestand is ${mb} MB. Bijlagen mogen maximaal 25 MB zijn.`,
    );
  }

  return extensie;
}

/**
 * Een naam op schijf die niets van de invoer overneemt behalve de extensie:
 * `2026/03/8f2c1e...a9.pdf`.
 *
 * Per maand een map, zodat één map niet volloopt met tienduizenden bestanden.
 */
export function genereerOpslagPad(extensie: string, nu = new Date()): string {
  const jaar = nu.getUTCFullYear();
  const maand = String(nu.getUTCMonth() + 1).padStart(2, '0');
  return `${jaar}/${maand}/${randomBytes(16).toString('hex')}.${extensie}`;
}

/** Een NUL-byte in een pad kapt in sommige lagen de rest van de tekst af. */
const NUL_BYTE = '\u0000';

/**
 * Zet een opgeslagen relatief pad om naar een absoluut pad, en weigert alles
 * wat buiten de bijlagenmap uit zou komen.
 *
 * Dit is de laatste controle vóór het lezen van een bestand: ook als er ooit
 * een verkeerd pad in de database belandt, kan er niets buiten de map worden
 * gelezen.
 */
export function absoluutBinnenMap(bijlagenMap: string, relatiefPad: string): string {
  if (relatiefPad === '' || isAbsolute(relatiefPad) || relatiefPad.includes(NUL_BYTE)) {
    throw new BijlageFout('ongeldig_pad', 'Dit bijlagepad is niet geldig.');
  }

  const basis = resolve(bijlagenMap);
  const doel = resolve(join(basis, relatiefPad));
  const verschil = relative(basis, doel);

  if (verschil === '' || verschil.startsWith('..') || isAbsolute(verschil)) {
    throw new BijlageFout(
      'ongeldig_pad',
      'Dit bijlagepad wijst buiten de bijlagenmap en wordt geweigerd.',
    );
  }
  if (verschil.split(sep).some((deel) => deel === '..')) {
    throw new BijlageFout('ongeldig_pad', 'Dit bijlagepad is niet geldig.');
  }

  return doel;
}

export function mimetypeVoor(extensie: string): string {
  return TOEGESTANE_EXTENSIES[extensie] ?? 'application/octet-stream';
}
