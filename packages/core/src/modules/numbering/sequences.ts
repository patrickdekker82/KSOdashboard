/**
 * Nummerreeksen voor offertes, projecten en kansen (hoofdstuk 4).
 *
 * Een nummer moet aan drie dingen voldoen: het is uniek, het loopt op, en er
 * zit geen gat in. Dat laatste is geen esthetiek — een boekhouder die OF-2026-
 * 0003 en OF-2026-0005 ziet, wil weten waar 0004 gebleven is.
 *
 * Daarom komt het nummer uit een teller in de database en niet uit `MAX(id)+1`
 * of uit een tijdstempel. Ophogen en uitlezen gebeuren in één transactie, zodat
 * twee aanvragen vlak na elkaar niet hetzelfde nummer krijgen. In deze
 * applicatie draait alles in één proces, maar in de hostmodus bedienen meerdere
 * werkplekken dezelfde database, en dan telt dat echt.
 */
import type { DatabaseHandle } from '../../db/client.ts';

export class NummerFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'NummerFout';
    this.code = code;
  }
}

type Rij = {
  key: string;
  prefix: string;
  next_value: number;
  padding: number;
  reset_period: 'nooit' | 'jaar' | 'maand';
  last_reset: string | null;
};

/** De periode waarin een teller wordt teruggezet: "2026" of "2026-03". */
export function periodeVan(reset: Rij['reset_period'], moment: Date): string | null {
  if (reset === 'jaar') return String(moment.getUTCFullYear());
  if (reset === 'maand') {
    return `${moment.getUTCFullYear()}-${String(moment.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Stelt het nummer samen: voorvoegsel, eventueel de periode, en de teller.
 *
 * Bij een jaarlijkse reset staat het jaar in het nummer. Zonder dat zou de
 * teller in januari terugspringen naar 0001 en zou dat nummer al bestaan.
 */
export function formatteerNummer(rij: Rij, waarde: number, periode: string | null): string {
  const delen = [rij.prefix, periode, String(waarde).padStart(Math.max(1, rij.padding), '0')];
  return delen.filter((deel) => deel !== null && deel !== '').join('-');
}

/**
 * Geeft het volgende nummer uit en hoogt de teller op.
 *
 * Draait in zijn eigen transactie, tenzij de aanroeper er al een open heeft —
 * SQLite kent geen geneste transacties, en een offerte aanmaken doet dit binnen
 * de transactie waarin ook de regels worden weggeschreven.
 */
export function volgendNummer(
  handle: DatabaseHandle,
  sleutel: string,
  nu = new Date(),
): string {
  const rij = handle.raw
    .prepare('SELECT * FROM number_sequences WHERE key = ?')
    .get(sleutel) as Rij | undefined;

  if (!rij) {
    throw new NummerFout(
      'onbekende_reeks',
      `Er is geen nummerreeks "${sleutel}" ingesteld. Een beheerder legt die vast bij de instellingen.`,
    );
  }

  const periode = periodeVan(rij.reset_period, nu);
  // Is de periode gewisseld, dan begint de teller opnieuw bij één.
  const opnieuw = periode !== null && rij.last_reset !== periode;
  const waarde = opnieuw ? 1 : Number(rij.next_value);

  handle.raw
    .prepare('UPDATE number_sequences SET next_value = ?, last_reset = ? WHERE key = ?')
    .run(waarde + 1, periode, sleutel);

  return formatteerNummer(rij, waarde, periode);
}

/** Het nummer dat als volgende zou worden uitgegeven, zonder op te hogen. */
export function bekijkVolgendNummer(
  handle: DatabaseHandle,
  sleutel: string,
  nu = new Date(),
): string | null {
  const rij = handle.raw
    .prepare('SELECT * FROM number_sequences WHERE key = ?')
    .get(sleutel) as Rij | undefined;
  if (!rij) return null;

  const periode = periodeVan(rij.reset_period, nu);
  const waarde = periode !== null && rij.last_reset !== periode ? 1 : Number(rij.next_value);
  return formatteerNummer(rij, waarde, periode);
}
