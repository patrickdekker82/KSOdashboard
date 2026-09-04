/**
 * Loads the capacity engine's input out of the database.
 *
 * The engines themselves stay pure; this module is the only place that knows
 * both the schema and the engine's shape.
 */
import {
  DEFAULT_APPOINTMENTS_PER_UNIT,
  DEFAULT_CAPACITY_SETTINGS,
  DEFAULT_LEAD_TIME_WEEKS,
  type CapacityInput,
  type CapacitySettings,
  type ClosureInput,
  type DayHours,
  type HolidayInput,
  type IsoWeek,
  type ProjectCapacityInput,
  type UserCapacityInput,
} from '@showroom/shared';
import type { DatabaseHandle } from '../../db/client.ts';

type Row = Record<string, unknown>;

const num = (value: unknown): number => Number(value ?? 0);
const str = (value: unknown): string => String(value ?? '');
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/** Reads a JSON setting, falling back to `fallback` when absent or corrupt. */
export function readSetting<T>(handle: DatabaseHandle, key: string, fallback: T): T {
  const row = handle.raw.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function loadCapacitySettings(handle: DatabaseHandle): CapacitySettings {
  return { ...DEFAULT_CAPACITY_SETTINGS, ...readSetting(handle, 'capaciteit', {}) };
}

/** Every guide, with their schedules, absences and allocations. */
export function loadUsers(handle: DatabaseHandle): UserCapacityInput[] {
  const users = handle.raw
    .prepare(
      `SELECT id, initials FROM users
        WHERE active = 1 AND archived_at IS NULL AND is_kopersbegeleider = 1
        ORDER BY initials`,
    )
    .all() as Row[];

  const schedules = handle.raw
    .prepare(
      `SELECT user_id, valid_from, valid_to, mon_hours, tue_hours, wed_hours, thu_hours,
              fri_hours, sat_hours, sun_hours, appointments_per_week
         FROM work_schedules
        WHERE archived_at IS NULL
        ORDER BY user_id, valid_from`,
    )
    .all() as Row[];

  const absences = handle.raw
    .prepare(
      `SELECT a.user_id, a.start_date, a.end_date, a.day_part, a.hours_override, a.status,
              t.reduces_capacity, t.name AS type_name
         FROM absences a
         JOIN absence_types t ON t.id = a.absence_type_id
        WHERE a.archived_at IS NULL
          AND a.status IN ('aangevraagd', 'goedgekeurd')`,
    )
    .all() as Row[];

  const allocations = handle.raw
    .prepare(
      `SELECT c.user_id, c.start_date, c.end_date, c.allocation_mode, c.allocation_value,
              c.status, c.title, t.reduces_showroom_capacity
         FROM capacity_allocations c
         JOIN allocation_types t ON t.id = c.allocation_type_id
        WHERE c.archived_at IS NULL
          AND c.status IN ('gepland', 'actief')`,
    )
    .all() as Row[];

  return users.map((user) => {
    const id = num(user.id);
    return {
      id,
      initials: str(user.initials),
      schedules: schedules
        .filter((row) => num(row.user_id) === id)
        .map((row) => ({
          validFrom: str(row.valid_from),
          validTo: nullableStr(row.valid_to),
          dayHours: [
            num(row.mon_hours),
            num(row.tue_hours),
            num(row.wed_hours),
            num(row.thu_hours),
            num(row.fri_hours),
            num(row.sat_hours),
            num(row.sun_hours),
          ] as unknown as DayHours,
          appointmentsPerWeek: num(row.appointments_per_week),
        })),
      absences: absences
        .filter((row) => num(row.user_id) === id)
        .map((row) => ({
          start: str(row.start_date),
          end: nullableStr(row.end_date),
          dayPart: str(row.day_part) as UserCapacityInput['absences'][number]['dayPart'],
          hoursOverride: row.hours_override === null ? null : num(row.hours_override),
          reducesCapacity: num(row.reduces_capacity) === 1,
          status: str(row.status) as UserCapacityInput['absences'][number]['status'],
          typeName: str(row.type_name),
        })),
      allocations: allocations
        .filter((row) => num(row.user_id) === id)
        .map((row) => ({
          start: str(row.start_date),
          end: str(row.end_date),
          mode: str(row.allocation_mode) as UserCapacityInput['allocations'][number]['mode'],
          value: num(row.allocation_value),
          status: str(row.status) as UserCapacityInput['allocations'][number]['status'],
          reducesShowroomCapacity: num(row.reduces_showroom_capacity) === 1,
          title: str(row.title),
        })),
    };
  });
}

/**
 * Confirmed projects (real showroom projects) plus, optionally, forecast
 * projects derived from open opportunities that carry an expected showroom
 * window and a number of homes.
 */
export function loadProjects(
  handle: DatabaseHandle,
  options: { includeForecast?: boolean } = {},
): ProjectCapacityInput[] {
  const defaultV = readSetting(handle, 'appointments_per_unit', DEFAULT_APPOINTMENTS_PER_UNIT);
  const defaultD = readSetting(handle, 'lead_time_weeks', DEFAULT_LEAD_TIME_WEEKS);

  const projects = handle.raw
    .prepare(
      `SELECT id, name, unit_count, appointments_per_unit, lead_time_weeks
         FROM projects
        WHERE archived_at IS NULL AND counts_as_showroom = 1`,
    )
    .all() as Row[];

  const phases = handle.raw
    .prepare(
      `SELECT f.project_id, f.start_date, f.end_date, f.unit_count_override, f.is_capacity_load,
              i.value AS phase_type
         FROM project_phases f
         JOIN picklist_items i ON i.id = f.phase_type_id
        WHERE f.archived_at IS NULL`,
    )
    .all() as Row[];

  const assignments = handle.raw
    .prepare(
      `SELECT project_id, user_id, share_bp, start_date, end_date
         FROM project_assignments
        WHERE archived_at IS NULL`,
    )
    .all() as Row[];

  const confirmed: ProjectCapacityInput[] = projects.map((project) => {
    const id = num(project.id);
    return {
      id,
      name: str(project.name),
      units: num(project.unit_count),
      appointmentsPerUnit:
        project.appointments_per_unit === null ? defaultV : num(project.appointments_per_unit),
      leadTimeWeeks:
        project.lead_time_weeks === null ? defaultD : num(project.lead_time_weeks),
      phases: phases
        .filter((row) => num(row.project_id) === id)
        .map((row) => ({
          type: str(row.phase_type),
          start: str(row.start_date),
          end: str(row.end_date),
          isLoad: num(row.is_capacity_load) === 1,
          unitsOverride:
            row.unit_count_override === null ? null : num(row.unit_count_override),
        })),
      assignments: assignments
        .filter((row) => num(row.project_id) === id)
        .map((row) => ({
          userId: num(row.user_id),
          shareBp: num(row.share_bp),
          start: nullableStr(row.start_date),
          end: nullableStr(row.end_date),
        })),
      confidence: 'bevestigd',
    };
  });

  if (!options.includeForecast) return confirmed;

  // Open opportunities become forecast projects; their probability drives the
  // weighting in the engine (hoofdstuk 7.3 stap 4).
  const forecast = handle.raw
    .prepare(
      `SELECT k.id, k.name, k.expected_units, k.expected_showroom_start, k.expected_showroom_end,
              COALESCE(k.probability_bp, s.default_probability_bp, 0) AS probability_bp
         FROM opportunities k
    LEFT JOIN pipeline_stages s ON s.id = k.stage_id
        WHERE k.archived_at IS NULL
          AND k.status = 'open'
          AND k.expected_units IS NOT NULL
          AND k.expected_showroom_start IS NOT NULL
          AND k.expected_showroom_end IS NOT NULL`,
    )
    .all() as Row[];

  return [
    ...confirmed,
    ...forecast.map((row) => ({
      // Negative ids keep forecast entries from colliding with real projects.
      id: -num(row.id),
      name: `${str(row.name)} (prognose)`,
      units: num(row.expected_units),
      appointmentsPerUnit: defaultV,
      leadTimeWeeks: defaultD,
      phases: [
        {
          type: 'showroom',
          start: str(row.expected_showroom_start),
          end: str(row.expected_showroom_end),
          isLoad: true,
        },
      ],
      assignments: [],
      confidence: 'prognose' as const,
      probabilityBp: num(row.probability_bp),
    })),
  ];
}

export function loadHolidays(handle: DatabaseHandle): HolidayInput[] {
  return (
    handle.raw.prepare('SELECT name, date, is_day_off FROM holidays').all() as Row[]
  ).map((row) => ({
    date: str(row.date),
    isDayOff: num(row.is_day_off) === 1,
    name: str(row.name),
  }));
}

export function loadClosures(handle: DatabaseHandle): ClosureInput[] {
  return (
    handle.raw
      .prepare(
        'SELECT start_date, end_date, user_id FROM closure_periods WHERE archived_at IS NULL',
      )
      .all() as Row[]
  ).map((row) => ({
    start: str(row.start_date),
    end: str(row.end_date),
    userId: row.user_id === null ? null : num(row.user_id),
  }));
}

/** Assembles the complete engine input for a week range. */
export function loadCapacityInput(
  handle: DatabaseHandle,
  from: IsoWeek,
  to: IsoWeek,
  overrides: Partial<CapacitySettings> = {},
): CapacityInput {
  const settings = { ...loadCapacitySettings(handle), ...overrides };
  return {
    from,
    to,
    settings,
    users: loadUsers(handle),
    projects: loadProjects(handle, { includeForecast: settings.includeForecast }),
    holidays: loadHolidays(handle),
    closures: loadClosures(handle),
  };
}
