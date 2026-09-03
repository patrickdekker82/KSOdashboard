/**
 * Money and rate helpers.
 *
 * Amounts are ALWAYS integer eurocents; rates and percentages are ALWAYS
 * integer basis points (0..10000, where 10000 = 100%). Floats never touch a
 * stored amount: every calculation ends in a single `Math.round`.
 */

/** Basis points: 10000 = 100%, 2150 = 21,5%. */
export type BasisPoints = number;
/** Integer eurocents. */
export type Cents = number;

export const BP_SCALE = 10_000;

/** Rounds to a whole cent, half away from zero (so -0,5 ct -> -1 ct). */
export function roundCents(value: number): Cents {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Applies a basis-point rate to an amount: 1000 ct at 2100 bp -> 210 ct. */
export function applyBp(amountCents: Cents, bp: BasisPoints): Cents {
  return roundCents((amountCents * bp) / BP_SCALE);
}

/**
 * Line amount: quantity x unit price, less a basis-point discount.
 * Rounds once, at the end, so 3 x 33,33 - 10% stays exact to the cent.
 */
export function lineAmountCents(
  quantity: number,
  unitPriceCents: Cents,
  discountBp: BasisPoints = 0,
): Cents {
  const gross = quantity * unitPriceCents;
  return roundCents(gross * (1 - discountBp / BP_SCALE));
}

/** Adds a margin expressed in basis points: 100 ct at 2500 bp -> 125 ct. */
export function addMarginBp(amountCents: Cents, marginBp: BasisPoints): Cents {
  return roundCents(amountCents * (1 + marginBp / BP_SCALE));
}

/** Margin in basis points between cost and sales price. Zero sales price -> 0. */
export function marginBp(salesCents: Cents, costCents: Cents): BasisPoints {
  if (salesCents === 0) return 0;
  return Math.round(((salesCents - costCents) / salesCents) * BP_SCALE);
}

export function eurosToCents(euros: number): Cents {
  return roundCents(euros * 100);
}

export function centsToEuros(cents: Cents): number {
  return cents / 100;
}

/** Sums cents safely (integers only, so no float drift). */
export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((total, value) => total + value, 0);
}
