/**
 * Een CSV-bestand lezen (hoofdstuk 11).
 *
 * Nederlandse Excel-exports gebruiken de puntkomma als scheidingsteken, want de
 * komma is hier het decimaalteken. Welke van de twee het is, wordt geraden aan
 * de eerste regel — dat is betrouwbaarder dan de gebruiker ernaar vragen, en
 * hij kan het in het scherm alsnog overrulen.
 *
 * De lezer volgt RFC 4180: velden mogen tussen dubbele aanhalingstekens staan,
 * en een aanhalingsteken in zo'n veld wordt verdubbeld. Regeleindes binnen een
 * veld tussen aanhalingstekens horen bij het veld en breken de rij niet af.
 */

export type CsvOpties = {
  /** Het scheidingsteken. Weglaten om het te laten raden. */
  scheidingsteken?: string;
};

const KANDIDATEN = [';', ',', '\t', '|'];

/**
 * Raadt het scheidingsteken aan de eerste regel buiten aanhalingstekens.
 *
 * Bij gelijkspel wint de puntkomma: dit is een Nederlandse applicatie en een
 * bestand met evenveel komma's als puntkomma's komt vrijwel altijd uit een
 * Nederlandse Excel.
 */
export function raadScheidingsteken(tekst: string): string {
  const regel = eersteRegelBuitenAanhalingstekens(tekst);
  let besteTeken = ';';
  let besteAantal = 0;

  for (const kandidaat of KANDIDATEN) {
    const aantal = telBuitenAanhalingstekens(regel, kandidaat);
    if (aantal > besteAantal) {
      besteAantal = aantal;
      besteTeken = kandidaat;
    }
  }

  return besteAantal === 0 ? ';' : besteTeken;
}

function eersteRegelBuitenAanhalingstekens(tekst: string): string {
  let inAanhalingstekens = false;
  for (let index = 0; index < tekst.length; index += 1) {
    const teken = tekst[index];
    if (teken === '"') inAanhalingstekens = !inAanhalingstekens;
    else if (!inAanhalingstekens && (teken === '\n' || teken === '\r')) return tekst.slice(0, index);
  }
  return tekst;
}

function telBuitenAanhalingstekens(regel: string, teken: string): number {
  let aantal = 0;
  let inAanhalingstekens = false;
  for (const karakter of regel) {
    if (karakter === '"') inAanhalingstekens = !inAanhalingstekens;
    else if (!inAanhalingstekens && karakter === teken) aantal += 1;
  }
  return aantal;
}

/** Leest een CSV naar rijen met tekstvelden. Lege regels vallen weg. */
export function leesCsv(inhoud: string, opties: CsvOpties = {}): string[][] {
  // Een byte order mark aan het begin is onzichtbaar maar plakt wel aan de
  // eerste kolomkop, en dan wordt "Projectnummer" niet meer herkend.
  const tekst = inhoud.replace(/^\uFEFF/, '');
  const scheidingsteken = opties.scheidingsteken ?? raadScheidingsteken(tekst);

  const rijen: string[][] = [];
  let rij: string[] = [];
  let veld = '';
  let inAanhalingstekens = false;

  const sluitVeld = (): void => {
    rij.push(veld);
    veld = '';
  };
  const sluitRij = (): void => {
    sluitVeld();
    if (rij.some((waarde) => waarde.trim() !== '')) rijen.push(rij);
    rij = [];
  };

  for (let index = 0; index < tekst.length; index += 1) {
    const teken = tekst[index]!;

    if (inAanhalingstekens) {
      if (teken !== '"') {
        veld += teken;
        continue;
      }
      // Twee aanhalingstekens achter elkaar zijn er één in het veld.
      if (tekst[index + 1] === '"') {
        veld += '"';
        index += 1;
        continue;
      }
      inAanhalingstekens = false;
      continue;
    }

    if (teken === '"' && veld.trim() === '') {
      inAanhalingstekens = true;
      veld = '';
      continue;
    }
    if (teken === scheidingsteken) {
      sluitVeld();
      continue;
    }
    if (teken === '\n') {
      sluitRij();
      continue;
    }
    if (teken === '\r') {
      // \r\n telt als één regeleinde.
      if (tekst[index + 1] === '\n') index += 1;
      sluitRij();
      continue;
    }

    veld += teken;
  }

  // Wat er na het laatste regeleinde nog staat, is ook een rij.
  if (veld !== '' || rij.length > 0) sluitRij();

  return rijen;
}
