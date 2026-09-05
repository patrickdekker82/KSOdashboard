/**
 * Wat een aanroep ongeveer kost (hoofdstuk 6.8).
 *
 * De prijzen staan in dollarcent per miljoen tokens, want zo rekent de
 * leverancier af. Er wordt hier bewust géén wisselkoers verzonnen: een koers
 * die in de code staat is binnen een maand onjuist en dan staat er een bedrag
 * in euro's op het scherm dat niemand kan terugvinden op de factuur. Het
 * scherm zet er daarom "US$" bij.
 *
 * Alleen modellen waarvan de prijs bekend is staan hieronder. Voor de rest
 * levert `raamKosten` `null` op en toont het scherm "onbekend" — beter dan een
 * verzonnen bedrag.
 */

export type Modelprijs = {
  /** Dollarcent per miljoen invoertokens. */
  invoer: number;
  /** Dollarcent per miljoen uitvoertokens. */
  uitvoer: number;
};

/** Prijslijst, in dollarcent per miljoen tokens. */
export const PRIJZEN: ReadonlyMap<string, Modelprijs> = new Map([
  // Claude Opus 5: $5 per miljoen invoertokens, $25 per miljoen uitvoertokens.
  ['claude-opus-5', { invoer: 500, uitvoer: 2500 }],
]);

/** Modellen die de instellingen aanbieden. Het schema kiest standaard Opus 5. */
export const MODELLEN = ['claude-opus-5'] as const;

/**
 * Raamt de kosten van één aanroep, in hele dollarcenten.
 *
 * Er wordt naar boven afgerond: een raming die te laag uitvalt is vervelender
 * dan een die een cent te hoog is. `null` betekent dat de prijs van dit model
 * hier niet bekend is.
 */
export function raamKosten(model: string, invoertokens: number, uitvoertokens: number): number | null {
  const prijs = PRIJZEN.get(model);
  if (prijs === undefined) return null;

  const centen =
    (invoertokens * prijs.invoer) / 1_000_000 + (uitvoertokens * prijs.uitvoer) / 1_000_000;

  return Math.ceil(centen);
}

/** `1234` → `US$ 12,34`. Voor het logboek. */
export function toonKosten(centen: number): string {
  const euro = Math.trunc(centen / 100);
  const rest = String(Math.abs(centen) % 100).padStart(2, '0');
  return `US$ ${euro.toLocaleString('nl-NL')},${rest}`;
}
