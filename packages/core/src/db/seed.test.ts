/**
 * Integratietest: seed -> repository -> capaciteitsengine.
 *
 * Dit is de test die aantoont dat de demo-data uit bijlage A werkelijk het
 * beeld oplevert dat de opdracht beschrijft: druk in het lopende kwartaal, een
 * zichtbare terugval doordat RB verlof heeft en DM deels elders zit, en een
 * herkenbaar capaciteitsgat verderop in het jaar.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addIsoWeeks, getIsoWeek, isoWeekKey } from '@showroom/shared';
import { openDatabase, type DatabaseHandle } from './client.ts';
import { applyViews, runMigrations } from './migrate.ts';
import { seed, DEMO_PASSWORD } from './seed.ts';
import { verifyPassword } from '../modules/auth/password.ts';
import { computeCapacity, findGaps } from '../modules/capacity/engine.ts';
import {
  loadCapacityInput,
  loadProjects,
  loadUsers,
  readSetting,
} from '../modules/capacity/repository.ts';

// Vast peilmoment, zodat de test niet van de kalender afhangt.
const REFERENCE = new Date('2026-09-07T00:00:00Z'); // maandag, 2026-W37
const REFERENCE_WEEK = getIsoWeek(REFERENCE);

let directory: string;
let handle: DatabaseHandle;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-seed-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);
  applyViews(handle);
  await seed(handle, { referenceDate: REFERENCE, demo: true });
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

const count = (table: string): number =>
  Number((handle.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

describe('basisseed', () => {
  it('zet de vijf gebruikers uit bijlage A neer met een werkend wachtwoord', async () => {
    expect(count('users')).toBe(5);
    const rb = handle.raw
      .prepare('SELECT password_hash, must_change_password FROM users WHERE initials = ?')
      .get('RB') as { password_hash: string; must_change_password: number };
    expect(await verifyPassword(rb.password_hash, DEMO_PASSWORD)).toBe(true);
    expect(rb.must_change_password).toBe(1);
  });

  it('geeft DM en PD een 5x8-rooster en RB een 4x8-rooster', () => {
    const users = loadUsers(handle);
    const hours = (initials: string): number => {
      const schedule = users.find((user) => user.initials === initials)!.schedules[0]!;
      return schedule.dayHours.reduce((sum, value) => sum + value, 0);
    };
    expect(hours('DM')).toBe(40);
    expect(hours('PD')).toBe(40);
    expect(hours('RB')).toBe(32); // parttime, maandag t/m donderdag
  });

  it('vult de stamgegevens: disciplines, fasen, types, feestdagen en sluitingen', () => {
    expect(count('disciplines')).toBe(9);
    expect(count('pipeline_stages')).toBe(6);
    expect(count('absence_types')).toBe(8);
    expect(count('allocation_types')).toBe(6);
    expect(count('holidays')).toBe(22); // elf feestdagen x twee jaar
    expect(count('closure_periods')).toBe(4); // bouwvak en kerst, twee jaar
    expect(count('alert_rules')).toBe(18);
    expect(count('email_templates')).toBe(5);
    expect(count('ai_presets')).toBe(5);
  });

  it('zet de capaciteitsinstellingen uit bijlage A', () => {
    const settings = readSetting(handle, 'capaciteit', {} as Record<string, unknown>);
    expect(settings.totalWeeklyCapacity).toBe(9); // A
    expect(settings.maxConcurrentProjects).toBe(3);
    expect(settings.capacityMode).toBe('laagste_van_beide');
    expect(readSetting(handle, 'appointments_per_unit', 0)).toBe(1); // V
    expect(readSetting(handle, 'lead_time_weeks', 0)).toBe(5); // D
  });

  it('registreert nooit de aard van een ziekte, alleen de afwezigheid', () => {
    const sick = handle.raw
      .prepare(
        `SELECT a.note, t.visibility FROM absences a
           JOIN absence_types t ON t.id = a.absence_type_id
          WHERE t.code = 'ZIEKTE'`,
      )
      .get() as { note: string | null; visibility: string };
    expect(sick.note).toBeNull();
    expect(sick.visibility).toBe('management');
  });
});

describe('demo-data', () => {
  it('legt de vijf voorbeeldprojecten aan, waarvan een zonder showroombelasting', () => {
    expect(count('projects')).toBe(5);
    const showroomProjects = loadProjects(handle);
    // Renovatie Kerkstraat telt niet als showroomproject.
    expect(showroomProjects).toHaveLength(4);
    expect(showroomProjects.map((project) => project.name)).not.toContain('Renovatie Kerkstraat');
  });

  it('splitst de gedeelde begeleiding DM/PD in twee toewijzingen van 50%', () => {
    const meesters = loadProjects(handle).find((p) => p.name === 'Meesters fase 2')!;
    expect(meesters.assignments).toHaveLength(2);
    expect(meesters.assignments.every((a) => a.shareBp === 5000)).toBe(true);
  });

  it('laat Kwartier Noord zonder showroomfase staan (project_unplanned)', () => {
    const kwartier = loadProjects(handle).find((p) => p.name === 'Kwartier Noord')!;
    expect(kwartier.phases.some((phase) => phase.isLoad)).toBe(false);
  });

  it('koppelt de inzet van DM aan het niet-showroomproject', () => {
    const allocation = handle.raw
      .prepare(
        `SELECT c.title, p.name AS project, p.counts_as_showroom
           FROM capacity_allocations c
           JOIN projects p ON p.id = c.project_id
          WHERE c.title = 'Renovatie Kerkstraat'`,
      )
      .get() as { project: string; counts_as_showroom: number };
    expect(allocation.project).toBe('Renovatie Kerkstraat');
    expect(allocation.counts_as_showroom).toBe(0);
  });

  it('zet een ziekmelding zonder einddatum neer', () => {
    const open = handle.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM absences a JOIN absence_types t ON t.id = a.absence_type_id
          WHERE a.end_date IS NULL AND t.code = 'ZIEKTE'`,
      )
      .get() as { n: number };
    expect(open.n).toBe(1);
  });
});

describe('seed door de capaciteitsengine', () => {
  const weeks = () =>
    computeCapacity(
      loadCapacityInput(handle, addIsoWeeks(REFERENCE_WEEK, -2), addIsoWeeks(REFERENCE_WEEK, 40)),
    ).weeks;

  const at = (offset: number) => {
    const target = addIsoWeeks(REFERENCE_WEEK, offset);
    return weeks().find(
      (week) => isoWeekKey({ year: week.isoYear, week: week.isoWeek }) === isoWeekKey(target),
    )!;
  };

  it('levert een aaneengesloten weekraster zonder gaten', () => {
    const result = weeks();
    expect(result).toHaveLength(43);
    const keys = result.map((week) => `${week.isoYear}-${week.isoWeek}`);
    expect(new Set(keys).size).toBe(43);
  });

  it('toont belasting in het lopende kwartaal', () => {
    expect(at(0).loadTotal).toBeGreaterThan(0);
    expect(at(3).loadTotal).toBeGreaterThan(0);
  });

  it('laat de capaciteit zichtbaar dalen in de weken dat RB verlof heeft', () => {
    // RB heeft verlof in week +2 en +3; DM zit tot week +5 voor 40% elders.
    const verlofweek = at(2);
    const rb = verlofweek.byUser.find((user) => user.initials === 'RB')!;
    expect(rb.leaveHours).toBe(32); // de hele parttime week
    expect(rb.capacity).toBe(0);

    const dm = verlofweek.byUser.find((user) => user.initials === 'DM')!;
    expect(dm.allocationHours).toBeGreaterThan(0);

    // De werkelijke capaciteit blijft onder de capaciteit bij volledige bezetting:
    // precies het verlies dat de grafiek gearceerd toont.
    expect(verlofweek.capacity).toBeLessThan(verlofweek.capacityIfFullyStaffed);
  });

  it('geeft DM zijn capaciteit terug zodra de inzet elders afloopt', () => {
    const tijdensInzet = at(4).byUser.find((user) => user.initials === 'DM')!;
    const naInzet = at(7).byUser.find((user) => user.initials === 'DM')!;
    expect(tijdensInzet.allocationHours).toBeGreaterThan(0);
    expect(naInzet.allocationHours).toBe(0);
    expect(naInzet.capacity).toBeGreaterThan(tijdensInzet.capacity);
  });

  it('markeert de kerstsluiting als gesloten week', () => {
    // De kerstsluiting loopt van 24 december t/m 2 januari. Week 52 begint op
    // 21 december en is dus maar deels gesloten; week 53 valt er volledig in.
    const week52 = getIsoWeek(new Date('2026-12-22T00:00:00Z'));
    const week53 = getIsoWeek(new Date('2026-12-30T00:00:00Z'));
    const find = (target: { year: number; week: number }) =>
      weeks().find(
        (week) => isoWeekKey({ year: week.isoYear, week: week.isoWeek }) === isoWeekKey(target),
      )!;

    expect(find(week53).isClosed).toBe(true);
    expect(find(week53).capacity).toBe(0);
    expect(find(week53).status).toBe('gesloten');
    expect(find(week52).isClosed).toBe(false);
  });

  it('vindt een capaciteitsgat verderop in het jaar met een acquisitiebehoefte', () => {
    const gaps = findGaps(weeks(), {
      thresholdPct: 50,
      minConsecutiveWeeks: 3,
      targetPct: 85,
      appointmentsPerUnit: 1,
    });
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    const grootste = gaps.reduce((max, gap) => (gap.weeks > max.weeks ? gap : max));
    expect(grootste.weeks).toBeGreaterThanOrEqual(6);
    expect(grootste.shortfallUnits).toBeGreaterThan(0);
  });
});
