/**
 * Package and quote pricing — hoofdstuk 6.5.
 *
 * Every amount is an integer number of eurocents. Floats are used only inside a
 * single expression and are rounded away before anything is stored or summed,
 * so totals never drift.
 */
import {
  addMarginBp,
  applyBp,
  lineAmountCents,
  marginBp as marginBpOf,
  roundCents,
  sumCents,
} from '@showroom/shared';
import type {
  PackageItemInput,
  PackagePrice,
  PackagePricingInput,
  PricedLine,
  Cents,
} from '@showroom/shared';

/** Whether a line counts towards the total: required lines always do. */
export function lineIsIncluded(item: PackageItemInput): boolean {
  return !item.isOptional || item.isSelected === true;
}

/**
 * Prices a package or quote.
 *
 * - `sum`             subtotal is the sum of the lines
 * - `sum_with_margin` that sum plus a margin in basis points
 * - `fixed`           a fixed price; the difference is spread proportionally
 *                     across the lines so per-rate VAT stays correct
 */
export function pricePackage(input: PackagePricingInput): PackagePrice {
  const included = input.items.filter(lineIsIncluded);

  // --- line amounts before any package-level adjustment ---------------------
  const rawAmounts = included.map((item) =>
    lineAmountCents(item.quantity, item.unitPriceCents, item.discountBp),
  );
  const rawSubtotal = sumCents(rawAmounts);

  // Total discount given away on the lines, for reporting.
  const grossTotal = roundCents(
    included.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0),
  );
  const discountCents = grossTotal - rawSubtotal;

  // --- the package-level target for the net total ---------------------------
  let targetSubtotal: Cents;
  switch (input.pricingMode) {
    case 'sum_with_margin':
      targetSubtotal = addMarginBp(rawSubtotal, input.marginBp ?? 0);
      break;
    case 'fixed':
      targetSubtotal = input.fixedPriceCents ?? 0;
      break;
    case 'sum':
    default:
      targetSubtotal = rawSubtotal;
      break;
  }

  // --- spread the adjustment across the lines -------------------------------
  // Largest-remainder distribution: proportional, and the cents always add up
  // to the target exactly rather than being off by one.
  const adjustedAmounts = distributeProportionally(rawAmounts, targetSubtotal);

  const lines: PricedLine[] = included.map((item, index) => {
    const amountCents = adjustedAmounts[index] ?? 0;
    return {
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      discountBp: item.discountBp,
      amountCents,
      vatRateBp: item.vatRateBp,
      vatCents: applyBp(amountCents, item.vatRateBp),
      isOptional: item.isOptional,
      isSelected: item.isSelected ?? !item.isOptional,
    };
  });

  const subtotalCents = sumCents(lines.map((line) => line.amountCents));
  const vatCents = sumCents(lines.map((line) => line.vatCents));

  // `vatMode` says whether the entered prices already include VAT.
  const totalExclVatCents = input.vatMode === 'incl' ? subtotalCents - vatCents : subtotalCents;
  const totalInclVatCents = input.vatMode === 'incl' ? subtotalCents : subtotalCents + vatCents;

  const costCents = sumCents(
    included.map((item) => roundCents((item.costPriceCents ?? 0) * item.quantity)),
  );
  const marginCents = totalExclVatCents - costCents;

  return {
    lines,
    subtotalCents,
    discountCents,
    vatCents,
    totalExclVatCents,
    totalInclVatCents,
    costCents,
    marginCents,
    marginBp: marginBpOf(totalExclVatCents, costCents),
    fixedAdjustmentCents: subtotalCents - rawSubtotal,
  };
}

/**
 * Scales `amounts` so they sum to exactly `target`, keeping each line's share.
 * Uses largest-remainder so the rounding difference lands on the biggest lines
 * instead of vanishing.
 */
export function distributeProportionally(
  amounts: readonly Cents[],
  target: Cents,
): Cents[] {
  const total = sumCents(amounts);
  if (amounts.length === 0) return [];
  if (total === target) return [...amounts];

  if (total === 0) {
    // Nothing to scale against: put everything on the first line.
    const result = amounts.map(() => 0);
    result[0] = target;
    return result;
  }

  const exact = amounts.map((amount) => (amount * target) / total);
  const floored = exact.map((value) => Math.floor(value));
  let remainder = target - floored.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  const result = [...floored];
  let cursor = 0;
  while (remainder !== 0 && order.length > 0) {
    const entry = order[cursor % order.length]!;
    result[entry.index] = (result[entry.index] ?? 0) + Math.sign(remainder);
    remainder -= Math.sign(remainder);
    cursor += 1;
  }
  return result;
}

/** True when the achieved margin sits below the configured minimum. */
export function marginBelowMinimum(price: PackagePrice, minimumMarginBp: number): boolean {
  return price.marginBp < minimumMarginBp;
}
