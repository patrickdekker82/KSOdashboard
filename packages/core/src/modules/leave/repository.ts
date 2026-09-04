/**
 * Haalt de invoer voor het verlofsaldo uit de database.
 *
 * De berekening zelf staat in `balance.ts` en raakt de database niet aan.
 */
import type { DayHours, HolidayInput, WorkScheduleInput } from '@showroom/shared';
import type { DatabaseHandle } from '../../db/client.ts';
import { berekenSaldo, type VerlofAfwezigheid, type Verlofsaldo } from './balance.ts';

type Rij = Record<string, unknown>;

const getal = (waarde: unknown): number => Number(waarde ?? 0);

function roosterVan(rij: Rij): WorkScheduleInput {
  return {
    validFrom: String(rij.valid_from),
    validTo: rij.valid_to === null || rij.valid_to === undefined ? null : String(rij.valid_to),
    dayHours: [
      getal(rij.mon_hours),
      getal(rij.tue_hours),
      getal(rij.wed_hours),
      getal(rij.thu_hours),
      getal(rij.fri_hours),
      getal(rij.sat_hours),
      getal(rij.sun_hours),
    ] as DayHours,
    appointmentsPerWeek: getal(rij.appointments_per_week),
  };
}

/**
 * Het saldo van elke actieve medewerker in één jaar.
 *
 * Iedereen komt in de lijst, ook wie nog geen recht heeft vastgelegd: dat een
 * saldo ontbreekt is juist iets wat een manager wil zien.
 */
export function laadSaldi(handle: DatabaseHandle, jaar: number): Verlofsaldo[] {
  const gebruikers = handle.raw
    .prepare(
      `SELECT id, name, initials FROM users
        WHERE active = 1 AND archived_at IS NULL
        ORDER BY initials`,
    )
    .all() as Rij[];

  const roosters = handle.raw
    .prepare(
      `SELECT user_id, valid_from, valid_to, mon_hours, tue_hours, wed_hours, thu_hours,
              fri_hours, sat_hours, sun_hours, appointments_per_week
         FROM work_schedules
        WHERE archived_at IS NULL
        ORDER BY user_id, valid_from`,
    )
    .all() as Rij[];

  // Ook afwezigheden die net buiten het jaar beginnen of eindigen: die lopen
  // er met een deel in, en dat deel telt mee.
  const afwezigheden = handle.raw
    .prepare(
      `SELECT a.user_id, a.start_date, a.end_date, a.day_part, a.hours_override, a.status,
              t.reduces_capacity, t.counts_as_leave, t.name AS type_name
         FROM absences a
         JOIN absence_types t ON t.id = a.absence_type_id
        WHERE a.archived_at IS NULL
          AND a.status IN ('aangevraagd', 'goedgekeurd')
          AND a.start_date <= ?
          AND (a.end_date IS NULL OR a.end_date >= ?)`,
    )
    .all(`${jaar}-12-31`, `${jaar}-01-01`) as Rij[];

  const feestdagen = handle.raw
    .prepare('SELECT date, is_day_off, name FROM holidays WHERE year = ?')
    .all(jaar) as Rij[];

  const saldi = handle.raw
    .prepare('SELECT user_id, entitlement_hours, carried_over_hours FROM leave_balances WHERE year = ?')
    .all(jaar) as Rij[];

  const roosterPerGebruiker = groepeer(roosters, (rij) => Number(rij.user_id), roosterVan);
  const afwezigPerGebruiker = groepeer(
    afwezigheden,
    (rij) => Number(rij.user_id),
    (rij): VerlofAfwezigheid => ({
      start: String(rij.start_date),
      end: rij.end_date === null || rij.end_date === undefined ? null : String(rij.end_date),
      dayPart: String(rij.day_part) as VerlofAfwezigheid['dayPart'],
      hoursOverride: rij.hours_override === null ? null : getal(rij.hours_override),
      reducesCapacity: Number(rij.reduces_capacity) === 1,
      countsAsLeave: Number(rij.counts_as_leave) === 1,
      status: String(rij.status) as VerlofAfwezigheid['status'],
      typeName: String(rij.type_name ?? ''),
    }),
  );

  const holidays: HolidayInput[] = feestdagen.map((rij) => ({
    date: String(rij.date),
    isDayOff: Number(rij.is_day_off) === 1,
    name: String(rij.name ?? ''),
  }));

  const rechtPerGebruiker = new Map<number, Rij>();
  for (const rij of saldi) rechtPerGebruiker.set(Number(rij.user_id), rij);

  return gebruikers.map((gebruiker) => {
    const id = Number(gebruiker.id);
    const recht = rechtPerGebruiker.get(id);
    return berekenSaldo({
      jaar,
      userId: id,
      initials: String(gebruiker.initials),
      name: String(gebruiker.name),
      entitlementHours: recht ? getal(recht.entitlement_hours) : null,
      carriedOverHours: recht ? getal(recht.carried_over_hours) : null,
      schedules: roosterPerGebruiker.get(id) ?? [],
      absences: afwezigPerGebruiker.get(id) ?? [],
      holidays,
    });
  });
}

function groepeer<T>(
  rijen: Rij[],
  sleutel: (rij: Rij) => number,
  maak: (rij: Rij) => T,
): Map<number, T[]> {
  const kaart = new Map<number, T[]>();
  for (const rij of rijen) {
    const id = sleutel(rij);
    kaart.set(id, [...(kaart.get(id) ?? []), maak(rij)]);
  }
  return kaart;
}
