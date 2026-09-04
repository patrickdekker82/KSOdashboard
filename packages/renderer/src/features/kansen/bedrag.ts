/**
 * Bedragen tussen invoerveld en centen.
 *
 * De gebruiker typt Nederlands ("1.234,56"), de kern rekent in hele centen.
 * De omrekening staat hier één keer, zodat er nergens een `parseFloat` op een
 * komma losgelaten wordt en er nergens een halve cent ontstaat.
 *
 * De omrekening schuift de komma op in de tekst zelf en gaat dus niet via een
 * kommagetal. Dat is geen overdreven zorgvuldigheid: `1.005 * 100` is in
 * drijvende komma 100,49999999999999, en dat rondt af naar € 1,00 terwijl de
 * gebruiker € 1,01 typte. Op één regel valt dat niemand op; op een offerte met
 * dertig regels wel.
 */

/** Haalt spaties, het euroteken en het procentteken weg. */
function schoon(tekst: string): string {
  return tekst.trim().replace(/[\s€%]/g, '');
}

/**
 * Verschuift de komma `decimalen` posities naar rechts en rondt af op een
 * geheel getal, halve waarden van nul af. Geeft `null` bij onleesbare invoer.
 */
function schaalNaarGeheel(tekst: string, decimalen: number): number | null {
  // Punten zijn duizendtallen, de komma is het decimaalteken.
  const genormaliseerd = schoon(tekst).replace(/\./g, '').replace(',', '.');
  if (genormaliseerd === '') return 0;

  const delen = /^(-?)(\d*)(?:\.(\d*))?$/.exec(genormaliseerd);
  if (!delen) return null;

  const teken = delen[1] === '-' ? -1 : 1;
  const heel = delen[2] ?? '';
  const fractie = delen[3] ?? '';
  if (heel === '' && fractie === '') return null;

  const schaal = 10 ** decimalen;
  const binnen = `${fractie}${'0'.repeat(decimalen)}`.slice(0, decimalen);
  const rest = fractie.slice(decimalen);

  let waarde = Number(heel || '0') * schaal + Number(binnen || '0');
  // Het eerste weggelaten cijfer bepaalt of er een eenheid bij moet.
  if (Number(rest[0] ?? '0') >= 5) waarde += 1;

  return Number.isFinite(waarde) ? teken * waarde : null;
}

/** "1.234,56" → 123456. Geeft `null` bij onleesbare invoer. */
export function naarCenten(tekst: string): number | null {
  return schaalNaarGeheel(tekst, 2);
}

/** 123456 → "1234,56". Zonder duizendscheiding, want het gaat terug een veld in. */
export function centenUit(centen: number): string {
  return (centen / 100).toFixed(2).replace('.', ',');
}

/** "12,5" → 1250 basispunten. Geeft `null` buiten 0–100%. */
export function naarBasispunten(tekst: string): number | null {
  const bp = schaalNaarGeheel(tekst, 2);
  // De kolom discount_bp heeft een CHECK tussen 0 en 10000; buiten dat bereik
  // stranden we hier al, in plaats van bij een SQL-fout die niemand begrijpt.
  if (bp === null || bp < 0 || bp > 10_000) return null;
  return bp;
}

/** 1250 → "12,5". */
export function basispuntenUit(bp: number): string {
  return String(bp / 100).replace('.', ',');
}

/**
 * "2,5" → 2.5 als getal. Geeft `null` bij onleesbare invoer.
 *
 * Een aantal mag wél een kommagetal blijven: `quantity` is in de database een
 * REAL, want een halve dag of 2,5 strekkende meter is een geldig aantal.
 */
export function naarGetal(tekst: string): number | null {
  const genormaliseerd = schoon(tekst).replace(/\./g, '').replace(',', '.');
  if (genormaliseerd === '') return 0;
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(genormaliseerd)) return null;
  const waarde = Number(genormaliseerd);
  return Number.isFinite(waarde) ? waarde : null;
}

/** 2.5 → "2,5". */
export function getalUit(waarde: number): string {
  return String(waarde).replace('.', ',');
}
