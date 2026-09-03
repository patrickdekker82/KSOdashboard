/**
 * ISO-8601 week arithmetic on UTC dates.
 *
 * Deliberately implemented on top of UTC `Date` arithmetic instead of `date-fns`:
 * `getISOWeek` and friends operate in the host's local timezone, which makes a
 * week boundary shift for users west of UTC and silently corrupts the capacity
 * grid. The engine must be timezone-independent, so all date maths here is UTC.
 * See docs/BESLISSINGEN.md.
 */

/** A single ISO week, e.g. week 53 of 2026 -> { year: 2026, week: 53 }. */
export type IsoWeek = { year: number; week: number };

/** ISO date string, `yyyy-MM-dd`. */
export type IsoDate = string;

const MS_PER_DAY = 86_400_000;

/** Parses `yyyy-MM-dd` into a UTC midnight Date. Throws on malformed input. */
export function parseIsoDate(value: IsoDate): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) throw new Error(`Ongeldige datum: "${value}" (verwacht jjjj-mm-dd)`);
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) throw new Error(`Ongeldige datum: "${value}"`);
  return date;
}

/** Formats a UTC Date as `yyyy-MM-dd`. */
export function toIsoDate(date: Date): IsoDate {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Adds `days` calendar days (UTC, DST-free). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Whole days between two UTC midnights (b - a). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** ISO weekday: Monday = 1 ... Sunday = 7. */
export function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the ISO week containing `date`. */
export function startOfIsoWeek(date: Date): Date {
  return addDays(date, 1 - isoWeekday(date));
}

/** The ISO week (and ISO week-numbering year) containing `date`. */
export function getIsoWeek(date: Date): IsoWeek {
  // Thursday of this week determines the ISO week-numbering year.
  const thursday = addDays(startOfIsoWeek(date), 3);
  const year = thursday.getUTCFullYear();
  const firstThursday = addDays(startOfIsoWeek(new Date(Date.UTC(year, 0, 4))), 3);
  const week = Math.round(daysBetween(firstThursday, thursday) / 7) + 1;
  return { year, week };
}

/** Monday (UTC midnight) of the given ISO week. */
export function isoWeekStart(isoWeek: IsoWeek): Date {
  const jan4 = new Date(Date.UTC(isoWeek.year, 0, 4));
  return addDays(startOfIsoWeek(jan4), (isoWeek.week - 1) * 7);
}

/** Sunday (UTC midnight) of the given ISO week. */
export function isoWeekEnd(isoWeek: IsoWeek): Date {
  return addDays(isoWeekStart(isoWeek), 6);
}

/** The seven UTC dates (Monday..Sunday) of the given ISO week. */
export function isoWeekDays(isoWeek: IsoWeek): Date[] {
  const monday = isoWeekStart(isoWeek);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Number of ISO weeks in a given ISO week-numbering year (52 or 53). */
export function isoWeeksInYear(year: number): number {
  // A year has 53 ISO weeks iff 28 December falls in week 53.
  return getIsoWeek(new Date(Date.UTC(year, 11, 28))).week;
}

/** Sortable key for an ISO week, e.g. 2026-W07 -> 202607. */
export function isoWeekKey(isoWeek: IsoWeek): number {
  return isoWeek.year * 100 + isoWeek.week;
}

/** Human label, e.g. "2026-W07". */
export function isoWeekLabel(isoWeek: IsoWeek): string {
  return `${isoWeek.year}-W${String(isoWeek.week).padStart(2, '0')}`;
}

/** Parses "2026-W07" / "2026W7" back into an IsoWeek. */
export function parseIsoWeek(value: string): IsoWeek {
  const match = /^(\d{4})-?W(\d{1,2})$/i.exec(value.trim());
  if (!match) throw new Error(`Ongeldige weeknotatie: "${value}" (verwacht jjjj-Www)`);
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > isoWeeksInYear(year)) {
    throw new Error(`Week ${week} bestaat niet in ${year}`);
  }
  return { year, week };
}

/** Shifts an ISO week by `delta` weeks, crossing 52/53-week years correctly. */
export function addIsoWeeks(isoWeek: IsoWeek, delta: number): IsoWeek {
  return getIsoWeek(addDays(isoWeekStart(isoWeek), delta * 7));
}

export function isoWeekEquals(a: IsoWeek, b: IsoWeek): boolean {
  return a.year === b.year && a.week === b.week;
}

/**
 * Inclusive list of ISO weeks from `from` to `to`.
 * Handles 53-week years and year boundaries without gaps or duplicates.
 */
export function isoWeekRange(from: IsoWeek, to: IsoWeek): IsoWeek[] {
  const weeks: IsoWeek[] = [];
  const end = isoWeekStart(to).getTime();
  let cursor = isoWeekStart(from);
  // Guard against an inverted range rather than looping forever.
  if (cursor.getTime() > end) return weeks;
  while (cursor.getTime() <= end) {
    weeks.push(getIsoWeek(cursor));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

/** The ISO week containing a `yyyy-MM-dd` date. */
export function isoWeekOfDate(date: IsoDate): IsoWeek {
  return getIsoWeek(parseIsoDate(date));
}

/** True when `date` lies within [start, end], with `end === null` meaning open-ended. */
export function dateWithin(date: Date, start: IsoDate, end: IsoDate | null): boolean {
  const t = date.getTime();
  if (t < parseIsoDate(start).getTime()) return false;
  if (end === null) return true;
  return t <= parseIsoDate(end).getTime();
}
