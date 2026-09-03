/**
 * Capacity engine — hoofdstuk 7.3 t/m 7.5.
 *
 * Pure functions over plain data: no database, no dates from the host clock,
 * so the whole thing is unit-testable and reproducible.
 */
import {
  addIsoWeeks,
  isoWeekEnd,
  isoWeekKey,
  isoWeekOfDate,
  isoWeekRange,
  isoWeekStart,
  toIsoDate,
  type IsoWeek,
} from '@showroom/shared';
import type {
  CapacityGap,
  CapacityInput,
  CapacityWeek,
  CapacityWeekProject,
  CapacityWeekUser,
  GapOptions,
  LoadKernel,
  ProjectCapacityInput,
  UserWeekAvailability,
  WeekStatus,
} from '@showroom/shared';
import {
  computeUserWeekAvailability,
  isWeekClosed,
  type AvailabilityOptions,
} from '../availability/engine.ts';

/**
 * Convolution kernel for the lead time D (hoofdstuk 7.3 stap 3).
 * Weights always sum to exactly 1, so no workload is created or lost.
 */
export function leadTimeKernel(leadTimeWeeks: number, kernel: LoadKernel): number[] {
  const d = Math.max(1, Math.round(leadTimeWeeks));
  let raw: number[];
  switch (kernel) {
    case 'front-loaded':
      raw = Array.from({ length: d }, (_, k) => d - k);
      break;
    case 'back-loaded':
      raw = Array.from({ length: d }, (_, k) => k + 1);
      break;
    case 'uniform':
    default:
      raw = Array.from({ length: d }, () => 1);
      break;
  }
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
}

type WeekMeta = {
  isoWeek: IsoWeek;
  key: number;
  isClosed: boolean;
  /** Index into the sequence of open weeks, or -1 when the week is closed. */
  openIndex: number;
};

/**
 * Spreads one phase's appointments over weeks.
 *
 * A phase of eight weeks always delivers eight weeks of work: closed weeks do
 * not swallow it, they push it forward (hoofdstuk 1, "werk schuift door naar na
 * de sluiting, het verdwijnt niet"). So we take as many OPEN weeks as the phase
 * has calendar weeks, starting at the phase start.
 */
function distributePhaseLoad(
  project: ProjectCapacityInput,
  phase: ProjectCapacityInput['phases'][number],
  weeks: readonly WeekMeta[],
): Map<number, number> {
  const result = new Map<number, number>();
  const startWeek = isoWeekOfDate(phase.start);
  const endWeek = isoWeekOfDate(phase.end);
  const phaseWeekCount = isoWeekRange(startWeek, endWeek).length;
  if (phaseWeekCount <= 0) return result;

  const units = phase.unitsOverride ?? project.units;
  const totalAppointments = units * project.appointmentsPerUnit;
  if (totalAppointments <= 0) return result;

  const startKey = isoWeekKey(startWeek);
  const openFromStart = weeks.filter((week) => !week.isClosed && week.key >= startKey);

  // Fallback: if the entire phase and everything after it is closed inside the
  // grid, put the work on the phase's own weeks rather than dropping it.
  const target =
    openFromStart.length > 0
      ? openFromStart.slice(0, phaseWeekCount)
      : weeks.filter((week) => week.key >= startKey).slice(0, phaseWeekCount);
  if (target.length === 0) return result;

  const perWeek = totalAppointments / phaseWeekCount;
  for (const week of target) {
    result.set(week.key, (result.get(week.key) ?? 0) + perWeek);
  }
  return result;
}

/**
 * Smears a base load over the lead time D.
 *
 * The convolution runs over the sequence of OPEN weeks, so a closure period in
 * the middle of the lead time shifts the tail instead of eating it.
 */
function convolveOverOpenWeeks(
  base: Map<number, number>,
  weeks: readonly WeekMeta[],
  weights: readonly number[],
): Map<number, number> {
  const openWeeks = weeks.filter((week) => !week.isClosed);
  const baseByOpenIndex = openWeeks.map((week) => base.get(week.key) ?? 0);
  const result = new Map<number, number>();

  openWeeks.forEach((week, index) => {
    let load = 0;
    for (let k = 0; k < weights.length; k += 1) {
      const source = index - k;
      if (source < 0) break;
      load += (baseByOpenIndex[source] ?? 0) * (weights[k] ?? 0);
    }
    if (load > 0) result.set(week.key, load);
  });

  return result;
}

/** Whether an assignment is in force during a given week. */
function assignmentActive(
  assignment: ProjectCapacityInput['assignments'][number],
  isoWeek: IsoWeek,
): boolean {
  const weekEnd = isoWeekEnd(isoWeek).getTime();
  const weekStart = isoWeekStart(isoWeek).getTime();
  if (assignment.start && new Date(`${assignment.start}T00:00:00Z`).getTime() > weekEnd) {
    return false;
  }
  if (assignment.end && new Date(`${assignment.end}T00:00:00Z`).getTime() < weekStart) {
    return false;
  }
  return true;
}

export type ComputeCapacityResult = {
  weeks: CapacityWeek[];
  /** Availability per user per week, keyed by ISO week key. */
  availability: Map<number, UserWeekAvailability[]>;
};

/** Full weekly capacity picture for the requested window. */
export function computeCapacity(input: CapacityInput): ComputeCapacityResult {
  const { settings } = input;
  const availabilityOptions: AvailabilityOptions = {
    includeRequestedAbsences: settings.includeRequestedAbsences,
    includePlannedAllocations: settings.includePlannedAllocations,
  };

  // The reported window, plus a run-up long enough for the longest lead time to
  // land correctly on the first reported week.
  const maxLeadTime = input.projects.reduce(
    (max, project) => Math.max(max, Math.round(project.leadTimeWeeks)),
    1,
  );
  const gridFrom = addIsoWeeks(input.from, -(maxLeadTime - 1));
  const gridTo = addIsoWeeks(input.to, maxLeadTime);
  const gridWeeks = isoWeekRange(gridFrom, gridTo);

  // --- availability and closed weeks ---------------------------------------
  const availability = new Map<number, UserWeekAvailability[]>();
  const weeks: WeekMeta[] = [];
  let openIndex = 0;

  for (const isoWeek of gridWeeks) {
    const perUser = input.users.map((user) =>
      computeUserWeekAvailability(
        user,
        isoWeek,
        input.holidays,
        input.closures,
        availabilityOptions,
      ),
    );
    availability.set(isoWeekKey(isoWeek), perUser);
    const closed = isWeekClosed(perUser);
    weeks.push({
      isoWeek,
      key: isoWeekKey(isoWeek),
      isClosed: closed,
      openIndex: closed ? -1 : openIndex,
    });
    if (!closed) openIndex += 1;
  }

  // --- load per project ------------------------------------------------------
  type ProjectLoad = {
    project: ProjectCapacityInput;
    /** Base appointments per week, before the lead-time smear. */
    base: Map<number, number>;
    /** Load after convolution, already weighted for forecast probability. */
    load: Map<number, number>;
    phaseTypeByWeek: Map<number, string>;
  };

  const projectLoads: ProjectLoad[] = [];

  for (const project of input.projects) {
    const base = new Map<number, number>();
    const phaseTypeByWeek = new Map<number, string>();

    for (const phase of project.phases) {
      if (!phase.isLoad) continue;
      const phaseLoad = distributePhaseLoad(project, phase, weeks);
      for (const [key, value] of phaseLoad) {
        base.set(key, (base.get(key) ?? 0) + value);
        if (!phaseTypeByWeek.has(key)) phaseTypeByWeek.set(key, phase.type);
      }
    }

    const weights = leadTimeKernel(project.leadTimeWeeks, settings.kernel);
    let load = convolveOverOpenWeeks(base, weeks, weights);

    // Forecast projects are weighted by their probability when asked for.
    if (project.confidence === 'prognose' && settings.forecastWeighting === 'probability') {
      const factor = (project.probabilityBp ?? 0) / 10_000;
      load = new Map([...load].map(([key, value]) => [key, value * factor]));
    }

    projectLoads.push({ project, base, load, phaseTypeByWeek });
  }

  // --- assemble the reported weeks ------------------------------------------
  const reported = isoWeekRange(input.from, input.to);
  const reportedKeys = new Set(reported.map((isoWeek) => isoWeekKey(isoWeek)));
  const result: CapacityWeek[] = [];

  for (const meta of weeks) {
    if (!reportedKeys.has(meta.key)) continue;
    const perUser = availability.get(meta.key) ?? [];

    // --- capacity per capacityMode ------------------------------------------
    const sumOfUsers = perUser.reduce((sum, entry) => sum + entry.capacity, 0);
    const sumIfStaffed = perUser.reduce((sum, entry) => sum + entry.capacityIfFullyStaffed, 0);
    const working = perUser.filter((entry) => entry.baseHours > 0);
    const avgFactor =
      working.length > 0
        ? working.reduce((sum, entry) => sum + entry.availabilityFactor, 0) / working.length
        : 0;
    const ceiling = settings.totalWeeklyCapacity;
    const scaledCeiling = ceiling === null ? Number.POSITIVE_INFINITY : ceiling * avgFactor;

    let capacity: number;
    let capacityIfFullyStaffed: number;
    switch (settings.capacityMode) {
      case 'som_medewerkers':
        capacity = sumOfUsers;
        capacityIfFullyStaffed = sumIfStaffed;
        break;
      case 'teamplafond':
        capacity = ceiling === null ? sumOfUsers : scaledCeiling;
        capacityIfFullyStaffed = ceiling ?? sumIfStaffed;
        break;
      case 'laagste_van_beide':
      default:
        capacity = Math.min(sumOfUsers, scaledCeiling);
        capacityIfFullyStaffed = Math.min(sumIfStaffed, ceiling ?? sumIfStaffed);
        break;
    }
    if (meta.isClosed) {
      capacity = 0;
      capacityIfFullyStaffed = 0;
    }

    // --- load in this week ----------------------------------------------------
    let loadConfirmed = 0;
    let loadForecast = 0;
    let concurrentProjects = 0;
    const projects: CapacityWeekProject[] = [];
    const loadByUser = new Map<number, number>();
    let unassignedLoad = 0;

    for (const entry of projectLoads) {
      const isForecast = entry.project.confidence === 'prognose';
      if (isForecast && !settings.includeForecast) continue;

      const weekLoad = entry.load.get(meta.key) ?? 0;
      if ((entry.base.get(meta.key) ?? 0) > 0) concurrentProjects += 1;
      if (weekLoad <= 0) continue;

      if (isForecast) loadForecast += weekLoad;
      else loadConfirmed += weekLoad;

      projects.push({
        id: entry.project.id,
        name: entry.project.name,
        load: round2(weekLoad),
        phaseType: entry.phaseTypeByWeek.get(meta.key) ?? 'showroom',
      });

      // Split the load across the guides assigned in this week.
      const active = entry.project.assignments.filter((assignment) =>
        assignmentActive(assignment, meta.isoWeek),
      );
      let assignedShare = 0;
      for (const assignment of active) {
        const share = assignment.shareBp / 10_000;
        assignedShare += share;
        loadByUser.set(
          assignment.userId,
          (loadByUser.get(assignment.userId) ?? 0) + weekLoad * share,
        );
      }
      unassignedLoad += weekLoad * Math.max(0, 1 - assignedShare);
    }

    const loadTotal = loadConfirmed + loadForecast;
    const utilisation = capacity > 0 ? loadTotal / capacity : loadTotal > 0 ? Infinity : 0;

    let status: WeekStatus;
    if (meta.isClosed) status = 'gesloten';
    else if (utilisation < settings.thresholds.green) status = 'groen';
    else if (utilisation <= settings.thresholds.orange) status = 'oranje';
    else status = 'rood';

    const byUser: CapacityWeekUser[] = perUser.map((entry) => {
      const userLoad = loadByUser.get(entry.userId) ?? 0;
      return {
        userId: entry.userId,
        initials: entry.initials,
        baseHours: entry.baseHours,
        holidayHours: entry.holidayHours,
        closureHours: entry.closureHours,
        leaveHours: entry.leaveHours,
        allocationHours: entry.allocationHours,
        availableHours: entry.availableHours,
        availabilityPct: round2(entry.availabilityFactor * 100),
        capacity: round2(entry.capacity),
        load: round2(userLoad),
        utilisationPct: entry.capacity > 0 ? round2((userLoad / entry.capacity) * 100) : 0,
        absences: entry.absences,
        allocations: entry.allocations,
      };
    });

    result.push({
      isoYear: meta.isoWeek.year,
      isoWeek: meta.isoWeek.week,
      startDate: toIsoDate(isoWeekStart(meta.isoWeek)),
      endDate: toIsoDate(isoWeekEnd(meta.isoWeek)),
      isClosed: meta.isClosed,
      loadConfirmed: round2(loadConfirmed),
      loadForecast: round2(loadForecast),
      loadTotal: round2(loadTotal),
      capacity: round2(capacity),
      capacityIfFullyStaffed: round2(capacityIfFullyStaffed),
      utilisationPct: Number.isFinite(utilisation) ? round2(utilisation * 100) : 0,
      status,
      concurrentProjects,
      guidesAvailable: perUser.filter((entry) => entry.availabilityFactor > 0).length,
      unassignedLoad: round2(unassignedLoad),
      byUser,
      projects: projects.sort((a, b) => b.load - a.load),
    });
  }

  return { weeks: result, availability };
}

/**
 * Gat­detectie — hoofdstuk 7.5.
 *
 * A gap is a run of at least `minConsecutiveWeeks` open weeks whose utilisation
 * stays below `thresholdPct`. `shortfallUnits` is the number the acquisition
 * meeting revolves around: how many homes are still needed.
 */
export function findGaps(
  weeks: readonly CapacityWeek[],
  options: Partial<GapOptions> & { appointmentsPerUnit?: number } = {},
): CapacityGap[] {
  const thresholdPct = options.thresholdPct ?? 50;
  const minConsecutiveWeeks = options.minConsecutiveWeeks ?? 3;
  const targetPct = options.targetPct ?? 85;
  const appointmentsPerUnit = options.appointmentsPerUnit ?? 1;

  const gaps: CapacityGap[] = [];
  let run: CapacityWeek[] = [];

  const flush = (): void => {
    if (run.length < minConsecutiveWeeks) {
      run = [];
      return;
    }
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const shortfallAppointments = run.reduce(
      (sum, week) => sum + Math.max(0, week.capacity * (targetPct / 100) - week.loadTotal),
      0,
    );
    const avgUtilisation = run.reduce((sum, week) => sum + week.utilisationPct, 0) / run.length;
    const avgCapacity = run.reduce((sum, week) => sum + week.capacity, 0) / run.length;

    gaps.push({
      startWeek: { year: first.isoYear, week: first.isoWeek },
      endWeek: { year: last.isoYear, week: last.isoWeek },
      weeks: run.length,
      avgUtilisationPct: round2(avgUtilisation),
      avgCapacity: round2(avgCapacity),
      shortfallAppointments: round2(shortfallAppointments),
      shortfallUnits: Math.ceil(shortfallAppointments / Math.max(appointmentsPerUnit, 1e-9)),
    });
    run = [];
  };

  for (const week of weeks) {
    // Closed weeks neither open nor break a gap: they are simply not workable.
    if (week.isClosed) continue;
    if (week.capacity > 0 && week.utilisationPct < thresholdPct) run.push(week);
    else flush();
  }
  flush();

  return gaps;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
