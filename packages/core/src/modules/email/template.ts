/**
 * Sjablonen invullen (hoofdstuk 9).
 *
 * Een sjabloon bevat plaatshouders als `{{contact.voornaam}}`. Deze module
 * vervangt die door de gegevens van het record waar de mail over gaat.
 *
 * Twee dingen zijn met opzet zo gebouwd:
 *
 * De opzoeking gaat nooit langs de prototypeketen. `{{contact.constructor}}`
 * of `{{contact.__proto__}}` levert dus niets op in plaats van een functie of
 * het prototype zelf — dezelfde les als bij de formule-evaluator, waar dat
 * gat er in een eerdere versie wél in zat.
 *
 * En een plaatshouder die niet ingevuld kan worden, wordt gemeld in plaats van
 * stil weggelaten. "Beste ," is erger dan een waarschuwing vooraf.
 */
import { formatCurrency, formatDate } from '@showroom/shared';

export type SjabloonWaarde = string | number | null;

/** De gegevens waar een sjabloon uit put, per onderwerp gegroepeerd. */
export type SjabloonContext = Map<string, Map<string, SjabloonWaarde>>;

export type IngevuldSjabloon = {
  tekst: string;
  /** Plaatshouders die in het sjabloon staan maar niet konden worden ingevuld. */
  ontbrekend: string[];
  /** Alle plaatshouders die het sjabloon gebruikt, ook de gevulde. */
  gebruikt: string[];
};

/** `{{ iets.anders }}` met willekeurige spaties eromheen. */
const PLAATSHOUDER = /\{\{\s*([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\}\}/gi;

/** Zet tekst veilig in HTML. */
export function escapeHtml(waarde: string): string {
  return waarde
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Vult een sjabloon in.
 *
 * `alsHtml` bepaalt of de waarden worden ontsnapt. In de HTML-body moet dat —
 * een klant die "Jansen & Zn" heet mag de opmaak niet stukmaken — en in het
 * onderwerp en de platte tekst juist niet.
 */
export function vulSjabloonIn(
  sjabloon: string,
  context: SjabloonContext,
  alsHtml = false,
): IngevuldSjabloon {
  const ontbrekend: string[] = [];
  const gebruikt: string[] = [];

  const tekst = sjabloon.replace(PLAATSHOUDER, (_volledig, groep: string, veld: string) => {
    const naam = `${groep}.${veld}`;
    if (!gebruikt.includes(naam)) gebruikt.push(naam);

    // Een Map en geen object-literal: een literal erft van Object.prototype,
    // en dan levert een opzoeking op "constructor" of "__proto__" iets op.
    const waarden = context.get(groep.toLowerCase());
    const waarde = waarden?.get(veld.toLowerCase());

    if (waarde === undefined || waarde === null || waarde === '') {
      if (!ontbrekend.includes(naam)) ontbrekend.push(naam);
      return '';
    }

    const tekstwaarde = String(waarde);
    return alsHtml ? escapeHtml(tekstwaarde) : tekstwaarde;
  });

  return { tekst, ontbrekend, gebruikt };
}

/** Alle plaatshouders die in een sjabloon voorkomen, zonder in te vullen. */
export function plaatshoudersIn(sjabloon: string): string[] {
  const gevonden: string[] = [];
  for (const treffer of sjabloon.matchAll(PLAATSHOUDER)) {
    const naam = `${treffer[1]}.${treffer[2]}`.toLowerCase();
    if (!gevonden.includes(naam)) gevonden.push(naam);
  }
  return gevonden;
}

// --- de context bouwen -----------------------------------------------------

/** Maakt een groep aan in de context, of vult een bestaande aan. */
export function zetGroep(
  context: SjabloonContext,
  groep: string,
  waarden: Record<string, SjabloonWaarde>,
): void {
  const bestaand = context.get(groep) ?? new Map<string, SjabloonWaarde>();
  for (const [sleutel, waarde] of Object.entries(waarden)) {
    bestaand.set(sleutel.toLowerCase(), waarde);
  }
  context.set(groep, bestaand);
}

/** Een datum uit de database als dd-MM-yyyy, of null. */
export function datum(waarde: unknown): string | null {
  if (typeof waarde !== 'string' || waarde.length < 10) return null;
  try {
    return formatDate(waarde.slice(0, 10));
  } catch {
    return null;
  }
}

/** Een bedrag in centen als "€ 1.234,56", of null. */
export function bedrag(waarde: unknown): string | null {
  const centen = Number(waarde);
  return Number.isFinite(centen) ? formatCurrency(centen) : null;
}
