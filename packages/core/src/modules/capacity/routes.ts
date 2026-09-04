/** Capacity endpoints — hoofdstuk 5. */
import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_GAP_OPTIONS,
  addIsoWeeks,
  getIsoWeek,
  isoWeekOfDate,
  parseIsoWeek,
  type CapacitySettings,
  type IsoWeek,
} from '@showroom/shared';
import { ApiError } from '../../server.ts';
import { computeCapacity, findGaps } from './engine.ts';
import { loadCapacityInput, readSetting } from './repository.ts';

/** Accepts "2026-W10" or a plain date; falls back to the current week. */
export function parseWeekParam(value: unknown, fallback: IsoWeek): IsoWeek {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const raw = value.trim();
  try {
    if (/^\d{4}-?W\d{1,2}$/i.test(raw)) return parseIsoWeek(raw);
    return isoWeekOfDate(raw);
  } catch (error) {
    throw new ApiError(
      400,
      'ongeldige_week',
      error instanceof Error ? error.message : `Ongeldige week: "${raw}".`,
    );
  }
}

function boolParam(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1' || value === true;
}

export async function registerCapacityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/capacity/weekly', async (request) => {
    const query = request.query as Record<string, unknown>;
    const current = getIsoWeek(new Date());
    const from = parseWeekParam(query.from, current);
    // Standaard 26 weken vooruit: de horizon waarop hoofdstuk 8 stuurt.
    const to = parseWeekParam(query.to, addIsoWeeks(from, 25));

    const overrides: Partial<CapacitySettings> = {};
    if (query.includeForecast !== undefined) {
      overrides.includeForecast = boolParam(query.includeForecast, true);
    }
    if (typeof query.capacityMode === 'string') {
      overrides.capacityMode = query.capacityMode as CapacitySettings['capacityMode'];
    }

    const input = loadCapacityInput(request.core.handle, from, to, overrides);
    const { weeks } = computeCapacity(input);
    return { data: weeks, meta: { from, to, instellingen: input.settings } };
  });

  app.get('/api/v1/capacity/gaps', async (request) => {
    const query = request.query as Record<string, unknown>;
    const current = getIsoWeek(new Date());
    const from = parseWeekParam(query.from, current);
    const to = parseWeekParam(query.to, addIsoWeeks(from, 51));

    const handle = request.core.handle;
    const { weeks } = computeCapacity(loadCapacityInput(handle, from, to));
    const gaps = findGaps(weeks, {
      thresholdPct: Number(query.threshold ?? DEFAULT_GAP_OPTIONS.thresholdPct),
      minConsecutiveWeeks: Number(query.minWeeks ?? DEFAULT_GAP_OPTIONS.minConsecutiveWeeks),
      targetPct: Number(query.target ?? DEFAULT_GAP_OPTIONS.targetPct),
      appointmentsPerUnit: readSetting(handle, 'appointments_per_unit', 1),
    });

    return { data: gaps, meta: { from, to } };
  });

  app.get('/api/v1/capacity/by-user', async (request) => {
    const query = request.query as Record<string, unknown>;
    const current = getIsoWeek(new Date());
    const from = parseWeekParam(query.from, current);
    const to = parseWeekParam(query.to, addIsoWeeks(from, 12));

    const { weeks } = computeCapacity(loadCapacityInput(request.core.handle, from, to));

    // Per begeleider een reeks over de weken heen, zodat de UI er direct een
    // strook per persoon van kan tekenen.
    const perUser = new Map<number, { initials: string; weken: unknown[] }>();
    for (const week of weeks) {
      for (const user of week.byUser) {
        const entry = perUser.get(user.userId) ?? { initials: user.initials, weken: [] };
        entry.weken.push({
          isoYear: week.isoYear,
          isoWeek: week.isoWeek,
          isClosed: week.isClosed,
          ...user,
        });
        perUser.set(user.userId, entry);
      }
    }

    return {
      data: [...perUser.entries()].map(([userId, entry]) => ({ userId, ...entry })),
      meta: { from, to },
    };
  });

  /**
   * Scenario-schuiven: dezelfde engine, maar met instellingen uit de body in
   * plaats van uit de database. Er wordt niets opgeslagen.
   */
  app.post('/api/v1/capacity/simulate', async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const current = getIsoWeek(new Date());
    const from = parseWeekParam(body.from, current);
    const to = parseWeekParam(body.to, addIsoWeeks(from, 25));

    const overrides: Partial<CapacitySettings> = {};
    if (body.A !== undefined) overrides.totalWeeklyCapacity = Number(body.A);
    if (body.capacityMode !== undefined) {
      overrides.capacityMode = body.capacityMode as CapacitySettings['capacityMode'];
    }
    if (body.includeForecast !== undefined) {
      overrides.includeForecast = Boolean(body.includeForecast);
    }
    if (body.includePlannedAllocations !== undefined) {
      overrides.includePlannedAllocations = Boolean(body.includePlannedAllocations);
    }
    if (body.kernel !== undefined) overrides.kernel = body.kernel as CapacitySettings['kernel'];

    const input = loadCapacityInput(request.core.handle, from, to, overrides);

    // V en D mogen in een scenario afwijken van wat er is vastgelegd.
    if (body.V !== undefined) {
      const v = Number(body.V);
      input.projects = input.projects.map((project) => ({ ...project, appointmentsPerUnit: v }));
    }
    if (body.D !== undefined) {
      const d = Number(body.D);
      input.projects = input.projects.map((project) => ({ ...project, leadTimeWeeks: d }));
    }

    const { weeks } = computeCapacity(input);
    return { data: weeks, meta: { from, to, instellingen: input.settings, scenario: true } };
  });
}
