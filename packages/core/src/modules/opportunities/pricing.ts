/**
 * Opportunity and discipline-line amounts — hoofdstuk 6.2.
 *
 * regel.bedrag   = round(aantal x eenheidsprijs x (1 - korting))
 * kans.bedrag    = sum of the line amounts
 * kans.gewogen   = sum of (line amount x line probability)
 *
 * The line probability falls back to the opportunity probability, which falls
 * back to the pipeline stage default.
 */
import { applyBp, lineAmountCents, roundCents, sumCents } from '@showroom/shared';
import type { BasisPoints, Cents } from '@showroom/shared';

export type OpportunityLineInput = {
  id?: number;
  disciplineId: number;
  description?: string;
  quantity: number;
  unitPriceCents: Cents;
  discountBp: BasisPoints;
  costPriceCents?: Cents;
  /** Line-level probability; falls back to the opportunity's own. */
  probabilityBp?: BasisPoints | null;
  status: 'open' | 'won' | 'lost';
  wonAmountCents?: Cents | null;
};

export type OpportunityPricingInput = {
  lines: OpportunityLineInput[];
  /** Opportunity probability; falls back to `stageProbabilityBp`. */
  probabilityBp?: BasisPoints | null;
  stageProbabilityBp: BasisPoints;
};

export type PricedOpportunityLine = {
  disciplineId: number;
  amountCents: Cents;
  costCents: Cents;
  marginCents: Cents;
  probabilityBp: BasisPoints;
  weightedAmountCents: Cents;
  status: 'open' | 'won' | 'lost';
};

export type OpportunityPrice = {
  lines: PricedOpportunityLine[];
  amountCents: Cents;
  weightedAmountCents: Cents;
  costCents: Cents;
  marginCents: Cents;
  /** Amount actually scored on lines marked as won. */
  wonAmountCents: Cents;
  lostAmountCents: Cents;
};

/** The probability that applies to a line, following the fallback chain. */
export function effectiveProbabilityBp(
  line: OpportunityLineInput,
  opportunityProbabilityBp: BasisPoints | null | undefined,
  stageProbabilityBp: BasisPoints,
): BasisPoints {
  if (line.probabilityBp != null) return line.probabilityBp;
  if (opportunityProbabilityBp != null) return opportunityProbabilityBp;
  return stageProbabilityBp;
}

export function priceOpportunity(input: OpportunityPricingInput): OpportunityPrice {
  const lines: PricedOpportunityLine[] = input.lines.map((line) => {
    const amountCents = lineAmountCents(line.quantity, line.unitPriceCents, line.discountBp);
    const costCents = roundCents((line.costPriceCents ?? 0) * line.quantity);
    const probabilityBp = effectiveProbabilityBp(
      line,
      input.probabilityBp,
      input.stageProbabilityBp,
    );
    return {
      disciplineId: line.disciplineId,
      amountCents,
      costCents,
      marginCents: amountCents - costCents,
      probabilityBp,
      // A won line is certain; a lost line is worth nothing.
      weightedAmountCents:
        line.status === 'won'
          ? (line.wonAmountCents ?? amountCents)
          : line.status === 'lost'
            ? 0
            : applyBp(amountCents, probabilityBp),
      status: line.status,
    };
  });

  const wonAmountCents = sumCents(
    input.lines
      .filter((line) => line.status === 'won')
      .map((line) =>
        line.wonAmountCents != null
          ? line.wonAmountCents
          : lineAmountCents(line.quantity, line.unitPriceCents, line.discountBp),
      ),
  );

  const lostAmountCents = sumCents(
    lines.filter((line) => line.status === 'lost').map((line) => line.amountCents),
  );

  return {
    lines,
    amountCents: sumCents(lines.map((line) => line.amountCents)),
    weightedAmountCents: sumCents(lines.map((line) => line.weightedAmountCents)),
    costCents: sumCents(lines.map((line) => line.costCents)),
    marginCents: sumCents(lines.map((line) => line.marginCents)),
    wonAmountCents,
    lostAmountCents,
  };
}

/** Scored revenue per discipline, for the reporting in 6.2. */
export function wonAmountByDiscipline(price: OpportunityPrice): Map<number, Cents> {
  const result = new Map<number, Cents>();
  for (const line of price.lines) {
    if (line.status !== 'won') continue;
    result.set(line.disciplineId, (result.get(line.disciplineId) ?? 0) + line.amountCents);
  }
  return result;
}
