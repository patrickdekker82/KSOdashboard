/**
 * Dubbelendetectie (hoofdstuk 6.1).
 *
 * Drie signalen, van sterk naar zwak:
 *   1. hetzelfde KvK-nummer          — dat is per definitie dezelfde partij
 *   2. hetzelfde adres               — postcode plus huisnummer
 *   3. een sterk gelijkende naam     — "Bouwbedrijf Meesters B.V." naast
 *                                      "Meesters Bouwbedrijf bv"
 *
 * Het eerste twee zijn feiten, het derde is een vermoeden. Daarom levert deze
 * module een score met een reden, en beslist een mens of het echt dubbel is.
 */

/**
 * Rechtsvormen die niets zeggen over de identiteit van een bedrijf.
 *
 * Deze worden op de opgeschoonde tekst weggehaald en niet woord voor woord:
 * "B.V." valt na het strippen van leestekens uiteen in "b" en "v", en die
 * zouden los nooit matchen.
 */
const RECHTSVORM_PATROON =
  /(^|\s)(b\s?v|n\s?v|v\s?o\s?f|c\s?v|holding|beheer|groep|group|nederland|netherlands|international)(?=\s|$)/g;

/**
 * Maakt namen vergelijkbaar: kleine letters, geen leestekens, geen
 * rechtsvormen, en woorden op alfabetische volgorde zodat "Bouwbedrijf
 * Meesters" en "Meesters Bouwbedrijf" hetzelfde opleveren.
 */
export function normaliseerNaam(naam: string): string {
  let tekst = naam
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Herhalen: "meesters bv holding" heeft twee opeenvolgende treffers, en na
  // de eerste vervanging schuift de tweede tegen een spatie aan.
  for (let ronde = 0; ronde < 4; ronde += 1) {
    const volgende = tekst.replace(RECHTSVORM_PATROON, ' ').replace(/\s+/g, ' ').trim();
    if (volgende === tekst) break;
    tekst = volgende;
  }

  return tekst.split(' ').filter(Boolean).sort().join(' ');
}

/** Postcode zonder spaties, in hoofdletters. */
export function normaliseerPostcode(postcode: string | null | undefined): string {
  return String(postcode ?? '').replace(/\s/g, '').toUpperCase();
}

/** KvK-nummer als alleen de cijfers, links aangevuld tot acht posities. */
export function normaliseerKvk(kvk: string | null | undefined): string {
  const cijfers = String(kvk ?? '').replace(/\D/g, '');
  return cijfers === '' ? '' : cijfers.padStart(8, '0');
}

/**
 * Levenshtein-afstand met een bovengrens.
 *
 * De grens is er niet voor de snelheid maar voor de betekenis: zodra twee
 * namen meer dan `maximum` bewerkingen uit elkaar liggen, zijn het geen
 * dubbelen meer en hoeft de rest niet uitgerekend te worden.
 */
export function levenshtein(a: string, b: string, maximum = 32): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maximum) return maximum + 1;

  let vorige = Array.from({ length: b.length + 1 }, (_, index) => index);
  let huidige = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    huidige[0] = i;
    let besteInRij = huidige[0]!;

    for (let j = 1; j <= b.length; j += 1) {
      const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
      huidige[j] = Math.min(
        (huidige[j - 1] ?? 0) + 1,
        (vorige[j] ?? 0) + 1,
        (vorige[j - 1] ?? 0) + kosten,
      );
      besteInRij = Math.min(besteInRij, huidige[j]!);
    }

    if (besteInRij > maximum) return maximum + 1;
    [vorige, huidige] = [huidige, vorige];
  }

  return vorige[b.length] ?? maximum + 1;
}

/** Gelijkenis tussen 0 en 1, op de genormaliseerde namen. */
export function naamGelijkenis(a: string, b: string): number {
  const links = normaliseerNaam(a);
  const rechts = normaliseerNaam(b);
  if (links === '' || rechts === '') return 0;
  if (links === rechts) return 1;

  const langste = Math.max(links.length, rechts.length);
  const afstand = levenshtein(links, rechts, Math.ceil(langste * 0.5));
  return Math.max(0, 1 - afstand / langste);
}

export type DubbelReden = 'kvk' | 'adres' | 'naam' | 'email';

export type Kandidaat = {
  id: number;
  naam: string;
  kvk: string | null;
  postcode: string | null;
  huisnummer: string | null;
  email?: string | null;
};

export type DubbelPaar = {
  a: number;
  b: number;
  /** 0..100; 100 is zeker, alles daaronder is een vermoeden. */
  score: number;
  redenen: DubbelReden[];
  uitleg: string;
};

export type DubbelOpties = {
  /** Onder deze naamgelijkenis wordt een paar niet gemeld. Default 0,85. */
  naamDrempel?: number;
};

/**
 * Zoekt paren die dezelfde partij lijken te zijn.
 *
 * Vergelijkt elk paar één keer (i < j) en levert de sterkste reden per paar.
 */
export function vindDubbelen(
  kandidaten: readonly Kandidaat[],
  opties: DubbelOpties = {},
): DubbelPaar[] {
  const drempel = opties.naamDrempel ?? 0.85;
  const paren: DubbelPaar[] = [];

  for (let i = 0; i < kandidaten.length; i += 1) {
    for (let j = i + 1; j < kandidaten.length; j += 1) {
      const a = kandidaten[i]!;
      const b = kandidaten[j]!;
      const redenen: DubbelReden[] = [];
      let score = 0;
      const uitleg: string[] = [];

      const kvkA = normaliseerKvk(a.kvk);
      const kvkB = normaliseerKvk(b.kvk);
      if (kvkA !== '' && kvkA === kvkB) {
        redenen.push('kvk');
        score = Math.max(score, 100);
        uitleg.push(`hetzelfde KvK-nummer (${kvkA})`);
      }

      const emailA = String(a.email ?? '').trim().toLowerCase();
      const emailB = String(b.email ?? '').trim().toLowerCase();
      if (emailA !== '' && emailA === emailB) {
        redenen.push('email');
        score = Math.max(score, 100);
        uitleg.push(`hetzelfde e-mailadres (${emailA})`);
      }

      const postcodeA = normaliseerPostcode(a.postcode);
      const postcodeB = normaliseerPostcode(b.postcode);
      const nummerA = String(a.huisnummer ?? '').trim();
      const nummerB = String(b.huisnummer ?? '').trim();
      if (postcodeA !== '' && postcodeA === postcodeB && nummerA !== '' && nummerA === nummerB) {
        redenen.push('adres');
        score = Math.max(score, 90);
        uitleg.push(`hetzelfde adres (${postcodeA} ${nummerA})`);
      }

      const gelijkenis = naamGelijkenis(a.naam, b.naam);
      if (gelijkenis >= drempel) {
        redenen.push('naam');
        score = Math.max(score, Math.round(gelijkenis * 85));
        uitleg.push(
          gelijkenis === 1
            ? 'dezelfde naam'
            : `sterk gelijkende naam (${Math.round(gelijkenis * 100)}%)`,
        );
      }

      if (redenen.length === 0) continue;

      paren.push({
        a: a.id,
        b: b.id,
        score,
        redenen,
        uitleg: `${a.naam} en ${b.naam}: ${uitleg.join(', ')}.`,
      });
    }
  }

  return paren.sort((links, rechts) => rechts.score - links.score);
}
