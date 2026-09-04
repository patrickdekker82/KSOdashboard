/** Availability, absence approval and holidays — hoofdstuk 5 en 6.4. */
import type { FastifyInstance } from 'fastify';
import {
  addIsoWeeks,
  getIsoWeek,
  isoWeekRange,
  type IsoWeek,
} from '@showroom/shared';
import { ApiError, currentUser, requireRole } from '../../server.ts';
import { computeCapacity } from '../capacity/engine.ts';
import { loadCapacityInput, loadClosures, loadHolidays, loadUsers } from '../capacity/repository.ts';
import { computeUserWeekAvailability } from './engine.ts';
import { generateHolidays } from './holidays.ts';
import { maySeeAbsenceType, type SessionUser } from '../auth/session.ts';
import { parseWeekParam } from '../capacity/routes.ts';
import { laadSaldi } from '../leave/repository.ts';
import type { DatabaseHandle } from '../../db/client.ts';

type Row = Record<string, unknown>;

/**
 * Hides the absence type from colleagues who may not see it. Everyone can see
 * *that* someone is away — the planning depends on it — but for a type marked
 * `management` the label becomes a neutral "Afwezig" (hoofdstuk 10).
 */
function maskAbsence(row: Row, viewer: SessionUser): Row {
  const visibility = String(row.visibility ?? 'iedereen') as 'iedereen' | 'management';
  if (maySeeAbsenceType(viewer, Number(row.user_id), visibility)) return row;
  return { ...row, type_name: 'Afwezig', type_code: null, note: null, color: '#9ca3af' };
}

function absenceRows(handle: DatabaseHandle, from: string, to: string): Row[] {
  return handle.raw
    .prepare(
      `SELECT a.id, a.user_id, u.initials, u.name AS user_name,
              a.absence_type_id, t.name AS type_name, t.code AS type_code, t.color,
              t.visibility, a.start_date, a.end_date, a.day_part, a.hours_override,
              a.status, a.note
         FROM absences a
         JOIN users u ON u.id = a.user_id
         JOIN absence_types t ON t.id = a.absence_type_id
        WHERE a.archived_at IS NULL
          AND a.start_date <= ?
          AND (a.end_date IS NULL OR a.end_date >= ?)
        ORDER BY a.start_date, u.initials`,
    )
    .all(to, from) as Row[];
}

export async function registerAvailabilityRoutes(app: FastifyInstance): Promise<void> {
  /** Per user per week: base days, holidays, leave, allocation, capacity. */
  app.get('/api/v1/availability/weekly', async (request) => {
    const query = request.query as Record<string, unknown>;
    const current = getIsoWeek(new Date());
    const from = parseWeekParam(query.from, current);
    const to = parseWeekParam(query.to, addIsoWeeks(from, 12));

    const handle = request.core.handle;
    const users = loadUsers(handle);
    const holidays = loadHolidays(handle);
    const closures = loadClosures(handle);
    const filter =
      typeof query.userIds === 'string'
        ? new Set(query.userIds.split(',').map((value) => Number(value)))
        : null;

    const weeks: IsoWeek[] = isoWeekRange(from, to);
    const data = weeks.map((isoWeek) => ({
      isoWeek,
      gebruikers: users
        .filter((user) => filter === null || filter.has(user.id))
        .map((user) => computeUserWeekAvailability(user, isoWeek, holidays, closures)),
    }));

    return { data, meta: { from, to } };
  });

  /**
   * The calendar grid behind the verlofkalender: absences and allocations in
   * one list, with the capacity strip that sits underneath every view.
   */
  app.get('/api/v1/availability/calendar', async (request) => {
    const query = request.query as Record<string, unknown>;
    const viewer = currentUser(request);
    const handle = request.core.handle;
    const current = getIsoWeek(new Date());
    const from = parseWeekParam(query.from, addIsoWeeks(current, -4));
    const to = parseWeekParam(query.to, addIsoWeeks(current, 20));

    const { weeks } = computeCapacity(loadCapacityInput(handle, from, to));
    const first = weeks[0];
    const last = weeks.at(-1);
    if (!first || !last) return { data: { afwezigheid: [], inzet: [], weken: [] } };

    const afwezigheid = absenceRows(handle, first.startDate, last.endDate).map((row) =>
      maskAbsence(row, viewer),
    );

    const inzet = handle.raw
      .prepare(
        `SELECT c.id, c.user_id, u.initials, u.name AS user_name, c.title,
                c.external_project_name, p.name AS project_name,
                t.name AS type_name, COALESCE(c.color, t.color) AS color,
                c.start_date, c.end_date, c.allocation_mode, c.allocation_value, c.status
           FROM capacity_allocations c
           JOIN users u ON u.id = c.user_id
           JOIN allocation_types t ON t.id = c.allocation_type_id
      LEFT JOIN projects p ON p.id = c.project_id
          WHERE c.archived_at IS NULL
            AND c.start_date <= ? AND c.end_date >= ?
          ORDER BY c.start_date`,
      )
      .all(last.endDate, first.startDate) as Row[];

    return { data: { afwezigheid, inzet, weken: weeks }, meta: { from, to } };
  });

  /**
   * What a request would do to the planning, shown before it is approved:
   * "Week 22: bezetting stijgt van 78% naar 116%."
   */
  app.get('/api/v1/absences/conflicts', async (request) => {
    const query = request.query as Record<string, unknown>;
    const handle = request.core.handle;
    const userId = Number(query.userId);
    const start = String(query.start ?? '');
    const end = query.end ? String(query.end) : start;
    if (!userId || !start) {
      throw new ApiError(400, 'onvolledig', 'Geef een medewerker en een startdatum op.');
    }

    const from = parseWeekParam(start, getIsoWeek(new Date()));
    const to = parseWeekParam(end, from);

    // Twee keer dezelfde berekening: zonder en met de voorgenomen afwezigheid.
    const base = loadCapacityInput(handle, from, to);
    const withAbsence = structuredClone(base);
    const target = withAbsence.users.find((user) => user.id === userId);
    if (target) {
      target.absences.push({
        start,
        end,
        dayPart: (query.dayPart as 'hele_dag') ?? 'hele_dag',
        reducesCapacity: true,
        status: 'goedgekeurd',
        typeName: 'Aangevraagd verlof',
      });
    }

    const voor = computeCapacity(base).weeks;
    const na = computeCapacity(withAbsence).weeks;
    const settings = base.settings;

    const waarschuwingen = na.map((week, index) => {
      const before = voor[index]!;
      const overload = week.utilisationPct > settings.thresholds.orange * 100;
      const teWeinigBegeleiders = week.guidesAvailable < settings.minGuidesAvailable;
      const alAfwezig = week.byUser
        .filter((user) => user.userId !== userId && user.leaveHours > 0)
        .map((user) => `${user.initials} (${user.leaveHours} uur)`);

      return {
        isoYear: week.isoYear,
        isoWeek: week.isoWeek,
        bezettingVoor: before.utilisationPct,
        bezettingNa: week.utilisationPct,
        capaciteitVoor: before.capacity,
        capaciteitNa: week.capacity,
        begeleidersBeschikbaar: week.guidesAvailable,
        overbezetting: overload,
        teWeinigBegeleiders,
        alAfwezig,
      };
    });

    const overlap = handle.raw
      .prepare(
        `SELECT id, start_date, end_date FROM absences
          WHERE user_id = ? AND archived_at IS NULL
            AND status IN ('aangevraagd','goedgekeurd')
            AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`,
      )
      .all(userId, end, start) as Row[];

    return {
      data: {
        overlap,
        weken: waarschuwingen,
        blokkeert: false, // waarschuwen, niet blokkeren (hoofdstuk 6.4.3)
      },
    };
  });

  // --- goedkeuringsstroom ---------------------------------------------------
  for (const [action, status] of [
    ['approve', 'goedgekeurd'],
    ['reject', 'afgewezen'],
  ] as const) {
    app.post(`/api/v1/absences/:id/${action}`, async (request) => {
      const user = requireRole(request, 'manager');
      const id = Number((request.params as { id: string }).id);
      const note = String((request.body as { note?: string } | undefined)?.note ?? '');

      const result = request.core.handle.raw
        .prepare(
          `UPDATE absences
              SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_note = ?
            WHERE id = ? AND status = 'aangevraagd'`,
        )
        .run(status, user.id, note || null, id);

      if (Number(result.changes ?? 0) === 0) {
        throw new ApiError(
          404,
          'niet_gevonden',
          'Deze aanvraag bestaat niet of is al beoordeeld.',
        );
      }
      return { id, status };
    });
  }

  app.post('/api/v1/absences/:id/cancel', async (request) => {
    const user = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const handle = request.core.handle;

    const row = handle.raw.prepare('SELECT user_id FROM absences WHERE id = ?').get(id) as
      | { user_id: number }
      | undefined;
    if (!row) throw new ApiError(404, 'niet_gevonden', 'Deze registratie bestaat niet.');

    // Je eigen verlof mag je altijd intrekken; dat van een ander alleen als manager.
    if (row.user_id !== user.id && user.role !== 'manager' && user.role !== 'admin') {
      throw new ApiError(403, 'geen_rechten', 'U mag alleen uw eigen verlof annuleren.');
    }

    handle.raw.prepare("UPDATE absences SET status = 'geannuleerd' WHERE id = ?").run(id);
    return { id, status: 'geannuleerd' };
  });

  // --- feestdagen -----------------------------------------------------------
  app.post('/api/v1/holidays/generate', async (request) => {
    requireRole(request, 'admin');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const year = Number(body.year ?? new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 1970 || year > 2200) {
      throw new ApiError(400, 'ongeldig_jaar', 'Geef een geldig jaartal op.');
    }

    const holidays = generateHolidays(year, {
      includeGoodFriday: Boolean(body.includeGoodFriday),
      includeLiberationDay: Boolean(body.includeLiberationDay),
    });

    const handle = request.core.handle;
    let toegevoegd = 0;
    for (const holiday of holidays) {
      // Bestaande feestdagen blijven staan: een handmatig aangepaste vrije dag
      // mag niet worden overschreven door de generator.
      const result = handle.raw
        .prepare(
          `INSERT OR IGNORE INTO holidays (name, date, is_day_off, auto_generated, year)
           VALUES (?, ?, ?, 1, ?)`,
        )
        .run(holiday.name, holiday.date, holiday.isDayOff ? 1 : 0, year);
      toegevoegd += Number(result.changes ?? 0);
    }

    return { jaar: year, toegevoegd, totaal: holidays.length };
  });

  /**
   * Het verlofsaldo per medewerker: recht, overheveling, opgenomen en wat er
   * nog vrij te plannen valt. Alles in uren (hoofdstuk 6.4.4).
   */
  app.get('/api/v1/leave-balances/overview', async (request) => {
    const query = request.query as Record<string, unknown>;
    const jaar = Number(query.year ?? new Date().getUTCFullYear());
    if (!Number.isInteger(jaar) || jaar < 1970 || jaar > 2200) {
      throw new ApiError(400, 'ongeldig_jaar', 'Geef een geldig jaartal op.');
    }
    return { data: laadSaldi(request.core.handle, jaar), meta: { jaar } };
  });

}
