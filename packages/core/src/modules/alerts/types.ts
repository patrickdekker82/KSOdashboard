/**
 * Wat een signaleringsregel oplevert (hoofdstuk 8.2).
 *
 * Een regel kijkt naar de gegevens en levert nul of meer bevindingen op. De
 * motor in `engine.ts` bepaalt vervolgens of dat een nieuwe melding is of een
 * die al openstond; de regel hoeft daar niets van te weten.
 */
import type { DatabaseHandle } from '../../db/client.ts';

export type Ernst = 'info' | 'let_op' | 'urgent';

export type Bevinding = {
  /**
   * De sleutel die deze bevinding uniek maakt binnen de regel.
   *
   * Twee keer dezelfde sleutel is dezelfde melding, ook als de tekst is
   * veranderd. Hierop wordt ontdubbeld, zodat een uurlijkse controle niet elk
   * uur dezelfde melding opnieuw opbouwt.
   */
  dedupeKey: string;
  titel: string;
  tekst: string | null;
  /** Waar de melding over gaat, zodat het scherm erheen kan linken. */
  entiteit: string | null;
  recordId: number | null;
  payload?: Record<string, unknown>;
};

export type RegelContext = {
  handle: DatabaseHandle;
  params: Record<string, unknown>;
  /** Het moment waarop de controle draait; injecteerbaar voor de tests. */
  nu: Date;
};

export type RegelHandler = (context: RegelContext) => Bevinding[];

/** Leest een getal uit de parameters van een regel, met een terugval. */
export function getal(params: Record<string, unknown>, sleutel: string, terugval: number): number {
  const waarde = Number(params[sleutel]);
  return Number.isFinite(waarde) ? waarde : terugval;
}
