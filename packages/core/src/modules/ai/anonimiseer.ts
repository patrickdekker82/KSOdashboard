/**
 * Persoonsgegevens vervangen door plaatshouders voordat er iets de deur uit
 * gaat, en ze in het antwoord weer terugzetten (hoofdstuk 6.8).
 *
 * De rest van deze applicatie praat met niets buiten deze computer. De
 * AI-assistent is de enige uitzondering, en dan alleen als de beheerder er
 * bewust een sleutel voor invult. Om die uitzondering zo klein mogelijk te
 * houden gaat er standaard geen enkele naam, adres, e-mailadres,
 * telefoonnummer of IBAN mee: die worden vervangen door «PERSOON_1»,
 * «ADRES_1», enzovoort. Het model schrijft zijn tekst over de plaatshouders,
 * en pas hier op de werkplek komen de echte gegevens er weer in.
 *
 * Deze module is met opzet zuiver: geen database, geen netwerk, geen datum.
 * Dat maakt hem volledig testbaar, en dat is precies wat je wil van het stukje
 * code dat bepaalt wat er wél en niet naar buiten gaat.
 */

/** Soorten gegevens die we herkennen. De naam komt terug in de plaatshouder. */
export type Soort = 'PERSOON' | 'ORGANISATIE' | 'ADRES' | 'EMAIL' | 'TELEFOON' | 'IBAN';

export type Vervanging = {
  soort: Soort;
  /** De echte waarde zoals hij in de tekst staat. */
  waarde: string;
  /** De plaatshouder die ervoor in de plaats komt, bijvoorbeeld `«PERSOON_1»`. */
  plaatshouder: string;
};

export type Woordenboek = {
  vervangingen: Vervanging[];
};

/**
 * De plaatshouders staan tussen dubbele guillemets. Die komen in Nederlandse
 * zakelijke tekst niet voor, dus het model kan ze niet per ongeluk zelf
 * verzinnen en wij kunnen ze zonder twijfel terugvinden.
 */
const OPEN = '«';
const SLUIT = '»';

/** Herkent een plaatshouder in een antwoord. */
const PLAATSHOUDER = new RegExp(
  `${OPEN}(PERSOON|ORGANISATIE|ADRES|EMAIL|TELEFOON|IBAN)_(\\d+)${SLUIT}`,
  'gu',
);

/**
 * Patronen die we ook zónder lijst uit de database herkennen. Dit is het
 * vangnet: een e-mailadres dat iemand in een notitie heeft getypt staat
 * nergens in een kolom, maar mag er net zo goed niet uit.
 *
 * Volgorde telt: IBAN vóór telefoon, anders knabbelt het telefoonpatroon aan
 * de cijfers van een rekeningnummer.
 */
const PATRONEN: Array<{ soort: Soort; patroon: RegExp }> = [
  // Een e-mailadres, ruim genomen maar zonder de omringende leestekens.
  { soort: 'EMAIL', patroon: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu },
  // Nederlandse IBAN: NL, twee controlecijfers, vier letters, tien cijfers.
  { soort: 'IBAN', patroon: /\bNL\d{2}[ ]?[A-Z]{4}[ ]?(?:\d{4}[ ]?){2}\d{2}\b/g },
  // Telefoonnummers: 06-12345678, 030 1234567, +31 6 12345678.
  {
    soort: 'TELEFOON',
    patroon: /(?:\+31[\s-]?\(?0?\)?|\b0)\d(?:[\s-]?\d){7,9}\b/g,
  },
  // Straat plus huisnummer: "Dorpsstraat 12", "Goghlaan 3-B".
  //
  // Bewust één woord: een patroon dat ook de woorden ervoor meepakt slikt
  // "Bezoek Dorpsstraat 12" in zijn geheel op, want "Bezoek" begint net zo
  // goed met een hoofdletter. Straatnamen uit meer woorden komen uit de
  // database (`address_street`) en lopen dus via de bekende waarden; dit
  // patroon is alleen het vangnet voor vrije tekst.
  {
    soort: 'ADRES',
    patroon:
      /\b\p{L}*(?:straat|laan|weg|plein|kade|dijk|singel|hof|pad|dreef|park|gracht)\s+\d+[\p{L}\d-]*/giu,
  },
  // Postcode, met of zonder spatie.
  { soort: 'ADRES', patroon: /\b\d{4}\s?[A-Z]{2}\b/g },
];

/** Tekens die in een regex letterlijk genomen moeten worden. */
function ontsnap(tekst: string): string {
  return tekst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Of een positie in de tekst aan een woordgrens ligt. `\b` van JavaScript kijkt
 * alleen naar ASCII, dus "Jansen" zou binnen "Janssen-Bakker" gevonden worden
 * en accenten zouden fout gaan. Dit doet het met Unicode.
 */
function isWoordteken(teken: string | undefined): boolean {
  return teken !== undefined && /[\p{L}\p{N}]/u.test(teken);
}

export type Bekend = { soort: Soort; waarde: string };

/**
 * Bouwt het woordenboek: welke waarde wordt welke plaatshouder.
 *
 * `bekend` zijn de waarden die we uit de database halen (namen van klanten,
 * contactpersonen, medewerkers, straatnamen). Ze worden op lengte gesorteerd,
 * zodat "Jan van der Berg" eerder aan de beurt is dan "Jan" — anders blijft
 * er "«PERSOON_1» van der Berg" staan en gaat de achternaam alsnog mee.
 *
 * Dezelfde waarde krijgt altijd dezelfde plaatshouder, ook als hij in twee
 * velden staat. Dat is wat het model nodig heeft om te snappen dat het over
 * dezelfde persoon gaat.
 */
export function bouwWoordenboek(tekst: string, bekend: Bekend[]): Woordenboek {
  const vervangingen: Vervanging[] = [];
  const gezien = new Map<string, string>();
  const tellers = new Map<Soort, number>();

  const nieuwePlaatshouder = (soort: Soort): string => {
    const nummer = (tellers.get(soort) ?? 0) + 1;
    tellers.set(soort, nummer);
    return `${OPEN}${soort}_${nummer}${SLUIT}`;
  };

  const voegToe = (soort: Soort, waarde: string): void => {
    const schoon = waarde.trim();
    if (schoon.length < 3) return; // "AB" of "Jo" levert alleen valse treffers op
    const stel = `${soort}:${schoon.toLocaleLowerCase('nl-NL')}`;
    if (gezien.has(stel)) return;

    const plaatshouder = nieuwePlaatshouder(soort);
    gezien.set(stel, plaatshouder);
    vervangingen.push({ soort, waarde: schoon, plaatshouder });
  };

  // Eerst de bekende waarden, langste eerst.
  const gesorteerd = [...bekend].sort((a, b) => b.waarde.trim().length - a.waarde.trim().length);
  for (const item of gesorteerd) {
    if (bevat(tekst, item.waarde.trim())) voegToe(item.soort, item.waarde);
  }

  // Daarna het vangnet, in de vaste volgorde van PATRONEN.
  for (const { soort, patroon } of PATRONEN) {
    for (const treffer of tekst.matchAll(new RegExp(patroon.source, patroon.flags))) {
      voegToe(soort, treffer[0]);
    }
  }

  return { vervangingen };
}

/**
 * Of `naald` als los woord in `hooiberg` voorkomt (hoofdletterongevoelig).
 *
 * Alle voorkomens worden nagelopen, niet alleen het eerste: in "Janssen is
 * niet Jan" zit "Jan" tweemaal, en de eerste is een deelwoord dat we juist
 * niet willen. Stoppen bij de eerste treffer zou de tweede laten lekken.
 */
function bevat(hooiberg: string, naald: string): boolean {
  if (naald === '') return false;

  const klein = hooiberg.toLocaleLowerCase('nl-NL');
  const zoek = naald.toLocaleLowerCase('nl-NL');

  for (let index = klein.indexOf(zoek); index !== -1; index = klein.indexOf(zoek, index + 1)) {
    if (!isWoordteken(hooiberg[index - 1]) && !isWoordteken(hooiberg[index + naald.length])) {
      return true;
    }
  }

  return false;
}

/**
 * Vervangt alle bekende waarden door hun plaatshouder.
 *
 * De vervangingen gaan in de volgorde van het woordenboek: de langste bekende
 * waarden eerst, daarna het vangnet. Wat al een plaatshouder is, wordt niet
 * nog eens vervangen — daar zorgt de woordgrenscontrole voor, want een
 * plaatshouder staat tussen guillemets en die zijn geen woordteken.
 */
export function anonimiseer(tekst: string, woordenboek: Woordenboek): string {
  let uitkomst = tekst;

  for (const vervanging of woordenboek.vervangingen) {
    const patroon = new RegExp(ontsnap(vervanging.waarde), 'giu');
    uitkomst = uitkomst.replace(patroon, (treffer, positie: number, geheel: string) => {
      const ervoor = geheel[positie - 1];
      const erna = geheel[positie + treffer.length];
      if (isWoordteken(ervoor) || isWoordteken(erna)) return treffer;
      return vervanging.plaatshouder;
    });
  }

  return uitkomst;
}

/**
 * Zet de echte waarden terug in het antwoord van het model.
 *
 * Een plaatshouder die het model verzonnen heeft (of die bij een ander verzoek
 * hoorde) blijft staan zoals hij is; dan is er duidelijk iets misgegaan en dat
 * moet de gebruiker zien in plaats van dat we er stilzwijgend een naam van
 * iemand anders in schuiven.
 */
export function herstel(tekst: string, woordenboek: Woordenboek): string {
  const opzoek = new Map(woordenboek.vervangingen.map((v) => [v.plaatshouder, v.waarde]));
  return tekst.replace(PLAATSHOUDER, (treffer) => opzoek.get(treffer) ?? treffer);
}

/** Welke plaatshouders in een tekst staan die het woordenboek niet kent. */
export function onbekendePlaatshouders(tekst: string, woordenboek: Woordenboek): string[] {
  const bekend = new Set(woordenboek.vervangingen.map((v) => v.plaatshouder));
  const gevonden = new Set<string>();

  for (const treffer of tekst.matchAll(PLAATSHOUDER)) {
    if (!bekend.has(treffer[0])) gevonden.add(treffer[0]);
  }

  return [...gevonden];
}

/**
 * Controleert achteraf of er echt niets persoonlijks meer in de tekst staat.
 *
 * Dit is de vangrail: als deze functie iets vindt, gaat het verzoek niet weg.
 * Beter een assistent die weigert dan een klantnaam die stilletjes naar een
 * API verdwijnt.
 */
export function restantenPersoonsgegevens(tekst: string, woordenboek: Woordenboek): string[] {
  const gevonden = new Set<string>();

  for (const vervanging of woordenboek.vervangingen) {
    if (bevat(tekst, vervanging.waarde)) gevonden.add(vervanging.waarde);
  }

  for (const { patroon } of PATRONEN) {
    for (const treffer of tekst.matchAll(new RegExp(patroon.source, patroon.flags))) {
      gevonden.add(treffer[0]);
    }
  }

  return [...gevonden];
}
