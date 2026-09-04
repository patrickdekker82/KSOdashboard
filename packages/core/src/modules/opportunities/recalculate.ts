/**
 * Afgeleide bedragen op een kans bijwerken (hoofdstuk 6.2).
 *
 * Regelbedrag, kansbedrag, gewogen bedrag en marge staan in de database omdat
 * er op gefilterd, gesorteerd en gerapporteerd wordt. Ze worden nooit door een
 * gebruiker ingevuld: bij elke wijziging aan een regel of aan de kans zelf
 * rekent deze module ze opnieuw uit met de prijsmodule.
 *
 * Dat is bewust één plek. Zou de UI het uitrekenen, dan klopt het niet meer
 * zodra er via de API, een import of een bulkactie iets verandert.
 */
import type { DatabaseHandle } from '../../db/client.ts';
import { priceOpportunity, type OpportunityLineInput } from './pricing.ts';

type Rij = Record<string, unknown>;

export type HerberekendResultaat = {
  opportunityId: number;
  amountCents: number;
  weightedAmountCents: number;
  wonAmountCents: number;
  regels: number;
};

/** De fasedefault die geldt als de kans zelf geen kans heeft ingevuld. */
function stageProbabilityBp(handle: DatabaseHandle, stageId: unknown): number {
  if (typeof stageId !== 'number') return 0;
  const rij = handle.raw
    .prepare('SELECT default_probability_bp FROM pipeline_stages WHERE id = ?')
    .get(stageId) as { default_probability_bp: number } | undefined;
  return Number(rij?.default_probability_bp ?? 0);
}

/**
 * Rekent één kans opnieuw door en schrijft de uitkomsten weg.
 *
 * Geeft `null` terug als de kans niet (meer) bestaat, zodat een aanroep na het
 * verwijderen van een regel geen fout oplevert.
 */
export function herberekenKans(
  handle: DatabaseHandle,
  opportunityId: number,
): HerberekendResultaat | null {
  const kans = handle.raw
    .prepare('SELECT id, probability_bp, stage_id FROM opportunities WHERE id = ?')
    .get(opportunityId) as Rij | undefined;
  if (!kans) return null;

  const rijen = handle.raw
    .prepare(
      `SELECT id, discipline_id, quantity, unit_price_cents, discount_bp, cost_price_cents,
              probability_bp, status, won_amount_cents
         FROM opportunity_lines
        WHERE opportunity_id = ? AND archived_at IS NULL
        ORDER BY sort_order, id`,
    )
    .all(opportunityId) as Rij[];

  const regels: Array<OpportunityLineInput & { id: number }> = rijen.map((rij) => ({
    id: Number(rij.id),
    disciplineId: Number(rij.discipline_id),
    quantity: Number(rij.quantity),
    unitPriceCents: Number(rij.unit_price_cents),
    discountBp: Number(rij.discount_bp),
    costPriceCents: Number(rij.cost_price_cents),
    probabilityBp: rij.probability_bp === null ? null : Number(rij.probability_bp),
    status: String(rij.status) as OpportunityLineInput['status'],
    wonAmountCents: rij.won_amount_cents === null ? null : Number(rij.won_amount_cents),
  }));

  const prijs = priceOpportunity({
    lines: regels,
    probabilityBp: kans.probability_bp === null ? null : Number(kans.probability_bp),
    stageProbabilityBp: stageProbabilityBp(handle, kans.stage_id),
  });

  // De regels bij: bedrag en marge zijn afgeleid, dus die schrijven we terug.
  const regelUpdate = handle.raw.prepare(
    'UPDATE opportunity_lines SET amount_cents = ?, margin_cents = ? WHERE id = ?',
  );
  prijs.lines.forEach((berekend, index) => {
    const regel = regels[index];
    if (!regel) return;
    regelUpdate.run(berekend.amountCents, berekend.marginCents, regel.id);
  });

  handle.raw
    .prepare(
      `UPDATE opportunities
          SET amount_cents = ?, weighted_amount_cents = ?, won_amount_cents = ?
        WHERE id = ?`,
    )
    .run(prijs.amountCents, prijs.weightedAmountCents, prijs.wonAmountCents, opportunityId);

  return {
    opportunityId,
    amountCents: prijs.amountCents,
    weightedAmountCents: prijs.weightedAmountCents,
    wonAmountCents: prijs.wonAmountCents,
    regels: regels.length,
  };
}

/**
 * Herberekent de kans waar een regel bij hoort.
 *
 * Wordt aangeroepen nadat een regel is aangemaakt, gewijzigd of gearchiveerd;
 * de regel zelf is dan al weg, dus het `opportunity_id` komt uit de rij die de
 * factory nog vasthield.
 */
export function herberekenViaRegel(handle: DatabaseHandle, regel: Rij | null): void {
  const opportunityId = regel?.opportunity_id;
  if (typeof opportunityId === 'number') herberekenKans(handle, opportunityId);
}

/** Alles opnieuw doorrekenen, bijvoorbeeld na een import. */
export function herberekenAlles(handle: DatabaseHandle): number {
  const rijen = handle.raw
    .prepare('SELECT id FROM opportunities WHERE archived_at IS NULL')
    .all() as Array<{ id: number }>;
  for (const rij of rijen) herberekenKans(handle, Number(rij.id));
  return rijen.length;
}
