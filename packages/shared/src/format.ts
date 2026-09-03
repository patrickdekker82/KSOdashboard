/**
 * Dutch presentation formatting. UI text only: never feed these back into a
 * calculation, and never store their output.
 */
import { parseIsoDate, type IsoDate, type IsoWeek } from './iso-week.ts';
import { centsToEuros, BP_SCALE, type BasisPoints, type Cents } from './money.ts';

const currencyFormatter = new Intl.NumberFormat('nl-NL', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('nl-NL', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** "€ 1.234,56" */
export function formatCurrency(cents: Cents): string {
  return currencyFormatter.format(centsToEuros(cents));
}

/** "1.234,56" — decimal comma, thousands separator. */
export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('nl-NL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDecimal(value: number): string {
  return numberFormatter.format(value);
}

/** Basis points as a Dutch percentage: 2150 -> "21,5%" */
export function formatBp(bp: BasisPoints, decimals = 1): string {
  return `${formatNumber((bp / BP_SCALE) * 100, decimals)}%`;
}

/** "dd-MM-yyyy" */
export function formatDate(value: IsoDate | Date): string {
  const date = typeof value === 'string' ? parseIsoDate(value) : value;
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${d}-${m}-${date.getUTCFullYear()}`;
}

/** "week 7 (2026)" */
export function formatIsoWeek(isoWeek: IsoWeek): string {
  return `week ${isoWeek.week} (${isoWeek.year})`;
}

/** "wk 7" — compact axis label. */
export function formatIsoWeekShort(isoWeek: IsoWeek): string {
  return `wk ${isoWeek.week}`;
}

/** "3,5 uur" / "1 uur" */
export function formatHours(hours: number): string {
  return `${formatDecimal(hours)} ${hours === 1 ? 'uur' : 'uur'}`;
}

/** Rounds a display percentage to whole numbers: 0.784 -> "78%" */
export function formatPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
