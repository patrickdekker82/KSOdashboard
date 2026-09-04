/**
 * Availability engine — hoofdstuk 7.2.
 *
 * Pure functions, no database access, so the whole thing is unit-testable.
 *
 * Everything is computed in HOURS rather than days. That is the only way
 * part-timers, half days and percentage allocations can be combined in one
 * calculation without rounding nonsense.
 */
import {
  dateWithin,
  isoWeekDays,
  isoWeekStart,
  isoWeekday,
  toIsoDate,
  type IsoDate,
  type IsoWeek,
} from '@showroom/shared';
import type {
  AbsenceInput,
  AllocationInput,
  AvailabilityBreakdownItem,
  ClosureInput,
  DayHours,
  HolidayInput,
  UserCapacityInput,
  UserWeekAvailability,
  WorkScheduleInput,
} from '@showroom/shared';

export type AvailabilityOptions = {
  /** Whether absences still awaiting approval already reduce capacity. */
  includeRequestedAbsences: boolean;
  /** Whether allocations with status 'gepland' already reduce capacity. */
  includePlannedAllocations: boolean;
};

export const DEFAULT_AVAILABILITY_OPTIONS: AvailabilityOptions = {
  includeRequestedAbsences: false,
  includePlannedAllocations: true,
};

const ZERO_DAY_HOURS: DayHours = [0, 0, 0, 0, 0, 0, 0];

/**
 * The schedule in force on a given date. Schedules are non-overlapping periods
 * per user; when several match we take the one that started most recently, so a
 * corrected schedule wins over the one it replaces.
 */
export function scheduleOn(
  schedules: readonly WorkScheduleInput[],
  date: IsoDate,
): WorkScheduleInput | null {
  const target = new Date(`${date}T00:00:00Z`).getTime();
  let best: WorkScheduleInput | null = null;
  for (const schedule of schedules) {
    const from = new Date(`${schedule.validFrom}T00:00:00Z`).getTime();
    if (from > target) continue;
    const to = schedule.validTo ? new Date(`${schedule.validTo}T00:00:00Z`).getTime() : null;
    if (to !== null && to < target) continue;
    if (best === null || schedule.validFrom > best.validFrom) best = schedule;
  }
  return best;
}

/** Scheduled hours for one weekday (ISO: Monday = 1 ... Sunday = 7). */
export function hoursForWeekday(dayHours: DayHours, weekday: number): number {
  return dayHours[weekday - 1] ?? 0;
}

/**
 * Fraction of a day covered by an absence, honouring day part and overrides.
 *
 * Exported because the leave balance (hoofdstuk 6.4.4) has to count exactly the
 * same hours. Two implementations of "how long is half a Wednesday for someone
 * who works four days" would drift apart the moment one of them is corrected.
 */
export function absenceHoursForDay(
  absence: AbsenceInput,
  dayScheduledHours: number,
  date: Date,
): number {
  if (dayScheduledHours <= 0) return 0;

  if (absence.hoursOverride != null) {
    // hours_override is expressed per day and can never exceed that day.
    return Math.min(absence.hoursOverride, dayScheduledHours);
  }

  // day_part applies to the first and last day of the range; days in between
  // are always whole days (schema comment on `absences.day_part`).
  const isBoundaryDay =
    toIsoDate(date) === absence.start || (absence.end !== null && toIsoDate(date) === absence.end);

  if (absence.dayPart === 'hele_dag' || !isBoundaryDay) return dayScheduledHours;
  return dayScheduledHours * 0.5; // ochtend or middag
}

function absenceCounts(absence: AbsenceInput, options: AvailabilityOptions): boolean {
  if (!absence.reducesCapacity) return false;
  if (absence.status === 'goedgekeurd') return true;
  return absence.status === 'aangevraagd' && options.includeRequestedAbsences;
}

function allocationCounts(allocation: AllocationInput, options: AvailabilityOptions): boolean {
  if (!allocation.reducesShowroomCapacity) return false;
  if (allocation.status === 'actief') return true;
  return allocation.status === 'gepland' && options.includePlannedAllocations;
}

/**
 * Availability for one user in one ISO week.
 *
 * Follows the seven steps of hoofdstuk 7.2 literally, including the
 * double-counting correction in step 6.
 */
export function computeUserWeekAvailability(
  user: UserCapacityInput,
  isoWeek: IsoWeek,
  holidays: readonly HolidayInput[],
  closures: readonly ClosureInput[],
  options: AvailabilityOptions = DEFAULT_AVAILABILITY_OPTIONS,
): UserWeekAvailability {
  const days = isoWeekDays(isoWeek);
  const mondayIso = toIsoDate(isoWeekStart(isoWeek));

  // --- step 1: base hours from the schedule in force on Monday of this week --
  const schedule = scheduleOn(user.schedules, mondayIso);
  const dayHours: DayHours = schedule?.dayHours ?? ZERO_DAY_HOURS;
  const appointmentsPerWeek = schedule?.appointmentsPerWeek ?? 0;

  const scheduledPerDay = days.map((date) => hoursForWeekday(dayHours, isoWeekday(date)));
  const baseHours = scheduledPerDay.reduce((sum, hours) => sum + hours, 0);
  const baseDays = scheduledPerDay.filter((hours) => hours > 0).length;

  // Lookup of days that are a day off because of a public holiday.
  const holidayDates = new Set(
    holidays.filter((holiday) => holiday.isDayOff).map((holiday) => holiday.date),
  );
  const holidayNameByDate = new Map(holidays.map((holiday) => [holiday.date, holiday.name]));

  const relevantClosures = closures.filter(
    (closure) => closure.userId === null || closure.userId === user.id,
  );

  // --- steps 2 and 3: holidays and closure periods --------------------------
  // A day that is both a public holiday and inside a closure is counted once,
  // under `holidayHours`; otherwise the two would double-count each other.
  let holidayHours = 0;
  let closureHours = 0;
  const blockedDay: boolean[] = [];

  days.forEach((date, index) => {
    const scheduled = scheduledPerDay[index] ?? 0;
    const iso = toIsoDate(date);
    const isHoliday = holidayDates.has(iso);
    const isClosed = relevantClosures.some((closure) => dateWithin(date, closure.start, closure.end));

    if (scheduled > 0 && isHoliday) holidayHours += scheduled;
    else if (scheduled > 0 && isClosed) closureHours += scheduled;

    blockedDay[index] = isHoliday || isClosed;
  });

  // --- step 4: approved leave ----------------------------------------------
  // Leave on a day that is already a holiday or a closure day adds nothing;
  // nobody spends leave hours on a day they were not working anyway.
  const activeAbsences = user.absences.filter((absence) => absenceCounts(absence, options));
  const leaveByType = new Map<string, number>();
  let leaveHours = 0;

  days.forEach((date, index) => {
    const scheduled = scheduledPerDay[index] ?? 0;
    if (scheduled <= 0 || blockedDay[index]) return;

    let remaining = scheduled;
    for (const absence of activeAbsences) {
      if (!dateWithin(date, absence.start, absence.end)) continue;
      // Overlapping absences never take more than the day actually holds.
      const hours = Math.min(absenceHoursForDay(absence, scheduled, date), remaining);
      if (hours <= 0) continue;
      remaining -= hours;
      leaveHours += hours;
      const key = absence.typeName ?? 'Afwezig';
      leaveByType.set(key, (leaveByType.get(key) ?? 0) + hours);
      if (remaining <= 0) break;
    }
  });

  // --- step 5: temporary allocation to other work ---------------------------
  const activeAllocations = user.allocations.filter((allocation) =>
    allocationCounts(allocation, options),
  );
  const allocationByTitle = new Map<string, number>();
  let allocationHours = 0;

  for (const allocation of activeAllocations) {
    // Pro rata: how much of this week's scheduled time the allocation covers.
    const coveredHours = days.reduce((sum, date, index) => {
      const scheduled = scheduledPerDay[index] ?? 0;
      if (scheduled <= 0) return sum;
      return dateWithin(date, allocation.start, allocation.end) ? sum + scheduled : sum;
    }, 0);
    if (coveredHours <= 0) continue;
    const overlapFactor = baseHours > 0 ? coveredHours / baseHours : 0;

    let weekHours: number;
    switch (allocation.mode) {
      case 'percentage':
        weekHours = baseHours * (allocation.value / 100);
        break;
      case 'dagen_per_week':
        weekHours = baseDays > 0 ? allocation.value * (baseHours / baseDays) : 0;
        break;
      case 'uren_per_week':
        weekHours = allocation.value;
        break;
    }

    const hours = weekHours * overlapFactor;
    if (hours <= 0) continue;
    allocationHours += hours;
    const key = allocation.title ?? 'Inzet elders';
    allocationByTitle.set(key, (allocationByTitle.get(key) ?? 0) + hours);
  }

  // --- step 6: prevent double counting -------------------------------------
  // Someone who is 40% on another project AND on leave for a week is 100% gone,
  // not 140%. Holidays, closures and leave come first; work elsewhere only
  // fills what is left of the week.
  const alreadyGone = holidayHours + closureHours + leaveHours;
  const occupiedHours = Math.min(
    baseHours,
    alreadyGone + Math.max(0, allocationHours - alreadyGone),
  );

  // --- step 7: what remains -------------------------------------------------
  const availableHours = Math.max(0, baseHours - occupiedHours);
  const availabilityFactor = baseHours > 0 ? availableHours / baseHours : 0;

  // Capacity if nobody took leave or worked elsewhere. Holidays and closures
  // still apply — a closed week has no capacity however well staffed it is.
  const staffedHours = Math.max(0, baseHours - Math.min(baseHours, holidayHours + closureHours));
  const staffedFactor = baseHours > 0 ? staffedHours / baseHours : 0;

  const toBreakdown = (map: Map<string, number>): AvailabilityBreakdownItem[] =>
    [...map.entries()]
      .map(([type, hours]) => ({ type, hours: round2(hours) }))
      .sort((a, b) => b.hours - a.hours);

  // Name the holidays taken in this week so the UI can label the block.
  const holidayBreakdown: AvailabilityBreakdownItem[] = [];
  days.forEach((date, index) => {
    const scheduled = scheduledPerDay[index] ?? 0;
    const iso = toIsoDate(date);
    if (scheduled > 0 && holidayDates.has(iso)) {
      holidayBreakdown.push({ type: holidayNameByDate.get(iso) ?? 'Feestdag', hours: scheduled });
    }
  });

  return {
    userId: user.id,
    initials: user.initials,
    isoWeek,
    baseHours: round2(baseHours),
    baseDays,
    holidayHours: round2(holidayHours),
    closureHours: round2(closureHours),
    leaveHours: round2(leaveHours),
    allocationHours: round2(allocationHours),
    occupiedHours: round2(occupiedHours),
    availableHours: round2(availableHours),
    availabilityFactor: round4(availabilityFactor),
    capacity: round4(appointmentsPerWeek * availabilityFactor),
    capacityIfFullyStaffed: round4(appointmentsPerWeek * staffedFactor),
    absences: [...holidayBreakdown, ...toBreakdown(leaveByType)],
    allocations: toBreakdown(allocationByTitle),
  };
}

/** Availability for every user across every week in the grid. */
export function computeAvailability(
  users: readonly UserCapacityInput[],
  weeks: readonly IsoWeek[],
  holidays: readonly HolidayInput[],
  closures: readonly ClosureInput[],
  options: AvailabilityOptions = DEFAULT_AVAILABILITY_OPTIONS,
): UserWeekAvailability[][] {
  return weeks.map((isoWeek) =>
    users.map((user) => computeUserWeekAvailability(user, isoWeek, holidays, closures, options)),
  );
}

/**
 * A week is closed when every working day in it is a holiday or falls inside a
 * closure period — for everyone who works that week.
 */
export function isWeekClosed(weekAvailability: readonly UserWeekAvailability[]): boolean {
  const working = weekAvailability.filter((entry) => entry.baseHours > 0);
  if (working.length === 0) return false;
  return working.every(
    (entry) => entry.holidayHours + entry.closureHours >= entry.baseHours - 1e-9,
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
