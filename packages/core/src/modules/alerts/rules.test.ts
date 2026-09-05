/**
 * Tests per signaleringsregel (hoofdstuk 8.2).
 *
 * Twee soorten. Eerst een gang langs de demoseed: die is zo gebouwd dat er
 * echt iets te melden valt, en dit is de enige plek waar de regels tegen een
 * volledige, samenhangende database draaien. Daarna per regel een klein geval
 * dat de demoseed niet raakt — een regel die nergens afgaat, is een regel
 * waarvan niemand weet of hij werkt.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { applyViews, runMigrations } from '../../db/migrate.ts';
import { seed } from '../../db/seed.ts';
import { REGELS } from './rules.ts';
import type { Bevinding } from './types.ts';

let directory: string;
let handle: DatabaseHandle;

const NU = new Date('2026-09-07T09:00:00Z');

/** Draait één regel los, zonder de motor ertussen. */
function voer(type: string, params: Record<string, unknown> = {}, nu = NU): Bevinding[] {
  const handler = REGELS.get(type);
  if (!handler) throw new Error(`Geen regel voor type "${type}"`);
  return handler({ handle, params, nu });
}

describe('tegen de demogegevens', () => {
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'showroom-regels-'));
    handle = openDatabase(join(directory, 'showroom.db'));
    runMigrations(handle);
    applyViews(handle);
    await seed(handle, { referenceDate: new Date('2026-09-07T00:00:00Z'), demo: true });
  });

  afterEach(() => {
    handle.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('ziet de structurele leegte die de demo bevat', () => {
    const bevindingen = voer('capacity_gap', {
      horizonWeeks: 26,
      thresholdPct: 50,
      minConsecutiveWeeks: 3,
      leadTimeWeeks: 8,
    });

    expect(bevindingen.length).toBeGreaterThan(0);
    expect(bevindingen[0]?.titel).toContain('loopt leeg');
    // De melding hoort te zeggen hoeveel woningen erbij moeten; zonder dat
    // getal is het geen bericht maar een constatering.
    expect(bevindingen[0]?.tekst).toMatch(/\d+ woningen extra/);
  });

  it('ziet de overbezette weken', () => {
    const bevindingen = voer('capacity_overload', { horizonWeeks: 12, thresholdPct: 100 });
    expect(bevindingen.length).toBeGreaterThan(0);
    expect(bevindingen[0]?.tekst).toContain('afspraken te veel');
  });

  it('ziet de weken die krap worden door afwezigheid', () => {
    expect(voer('capacity_understaffed', { horizonWeeks: 12 }).length).toBeGreaterThan(0);
  });

  it('ziet de ziekmelding zonder einddatum', () => {
    const bevindingen = voer('sick_leave_open', { days: 7 });
    expect(bevindingen).toHaveLength(1);
    // De aard van de ziekte wordt nergens vastgelegd, ook niet in de melding.
    expect(bevindingen[0]?.titel).not.toMatch(/ziek/i);
    expect(bevindingen[0]?.tekst).not.toMatch(/ziek/i);
  });

  it('ziet het project zonder showroomplanning', () => {
    const bevindingen = voer('project_unplanned');
    expect(bevindingen).toHaveLength(1);
    expect(bevindingen[0]?.entiteit).toBe('projects');
  });

  it('ziet het project dat alleen op één afwezige begeleider draait', () => {
    const bevindingen = voer('project_single_guide');
    expect(bevindingen).toHaveLength(1);
    expect(bevindingen[0]?.titel).toContain('en die is afwezig');
  });

  // Twee overlappende afwezigheden van dezelfde begeleider zijn niet twee
  // problemen: het probleem is dat er niemand anders is.
  it('meldt één keer per project, ook bij meerdere afwezigheden', () => {
    const project = handle.raw
      .prepare(`SELECT id FROM projects WHERE name = 'De Hoventier hof'`)
      .get() as { id: number };
    const begeleider = handle.raw
      .prepare('SELECT user_id FROM project_assignments WHERE project_id = ?')
      .get(project.id) as { user_id: number };

    handle.raw
      .prepare(
        `INSERT INTO absences (user_id, absence_type_id, start_date, end_date, status)
         VALUES (?, (SELECT id FROM absence_types WHERE code = 'VERLOF'), '2026-10-05', '2026-10-09', 'goedgekeurd')`,
      )
      .run(begeleider.user_id);

    expect(voer('project_single_guide')).toHaveLength(1);
  });

  it('ziet de projecten zonder klant als datakwaliteit', () => {
    const bevindingen = voer('data_quality');
    expect(bevindingen.some((bevinding) => bevinding.dedupeKey === 'kwaliteit:klant')).toBe(true);
  });
});

describe('per regel, met een eigen geval', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'showroom-regel-'));
    handle = openDatabase(join(directory, 'showroom.db'));
    runMigrations(handle);

    handle.raw
      .prepare(
        `INSERT INTO users (name, initials, email, password_hash, is_kopersbegeleider)
         VALUES ('Dennis', 'DM', 'd@t.local', 'x', 1)`,
      )
      .run();
    handle.raw
      .prepare(
        `INSERT INTO work_schedules (user_id, valid_from, mon_hours, tue_hours, wed_hours,
                                     thu_hours, fri_hours, appointments_per_week)
         VALUES (1, '2020-01-01', 8, 8, 8, 8, 8, 15)`,
      )
      .run();
  });

  afterEach(() => {
    handle.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('meldt inzet die binnenkort afloopt, als goed nieuws', () => {
    handle.raw
      .prepare("INSERT INTO allocation_types (name, code) VALUES ('Ander project', 'ANDER')")
      .run();
    handle.raw
      .prepare(
        `INSERT INTO capacity_allocations
           (user_id, allocation_type_id, title, start_date, end_date, allocation_mode,
            allocation_value, status)
         VALUES (1, 1, 'Renovatie Kerkstraat', '2026-08-01', '2026-09-18', 'percentage', 40, 'actief')`,
      )
      .run();

    const bevindingen = voer('allocation_ending', { daysAhead: 21 });
    expect(bevindingen).toHaveLength(1);
    expect(bevindingen[0]?.titel).toContain('weer beschikbaar');
  });

  it('meldt inzet die pas veel later afloopt niet', () => {
    handle.raw
      .prepare("INSERT INTO allocation_types (name, code) VALUES ('Ander project', 'ANDER')")
      .run();
    handle.raw
      .prepare(
        `INSERT INTO capacity_allocations
           (user_id, allocation_type_id, title, start_date, end_date, allocation_mode,
            allocation_value, status)
         VALUES (1, 1, 'Lang traject', '2026-08-01', '2026-12-31', 'percentage', 40, 'actief')`,
      )
      .run();

    expect(voer('allocation_ending', { daysAhead: 21 })).toHaveLength(0);
  });

  it('meldt een showroomfase die begint zonder begeleider', () => {
    maakProjectMetFase('Plan Zuidhoek', '2026-10-05', '2026-11-27');

    const bevindingen = voer('project_phase_missing', { daysBefore: 60 });
    expect(bevindingen).toHaveLength(1);
    expect(bevindingen[0]?.titel).toContain('zonder begeleider');
  });

  it('meldt niets als er wel een begeleider op zit', () => {
    const projectId = maakProjectMetFase('Plan Zuidhoek', '2026-10-05', '2026-11-27');
    handle.raw
      .prepare('INSERT INTO project_assignments (project_id, user_id) VALUES (?, 1)')
      .run(projectId);

    expect(voer('project_phase_missing', { daysBefore: 60 })).toHaveLength(0);
  });

  it('meldt een kans waarvan de sluitdatum nadert', () => {
    handle.raw
      .prepare(
        `INSERT INTO opportunities (name, status, expected_close_date, amount_cents)
         VALUES ('Plan Zuidhoek 32 woningen', 'open', '2026-09-15', 3440000)`,
      )
      .run();

    const bevindingen = voer('opportunity_closing', { daysAhead: 14 });
    expect(bevindingen).toHaveLength(1);
    expect(bevindingen[0]?.tekst).toContain('€');
  });

  it('meldt een gewonnen kans niet, ook niet als de datum nadert', () => {
    handle.raw
      .prepare(
        `INSERT INTO opportunities (name, status, expected_close_date, amount_cents)
         VALUES ('Al binnen', 'won', '2026-09-15', 3440000)`,
      )
      .run();

    expect(voer('opportunity_closing', { daysAhead: 14 })).toHaveLength(0);
  });

  it('meldt een verstuurde offerte waar niets op terugkomt', () => {
    handle.raw
      .prepare(
        `INSERT INTO package_quotes (number, status, sent_at, total_cents)
         VALUES ('O26001', 'verstuurd', '2026-08-20 10:00:00', 1250000)`,
      )
      .run();

    const bevindingen = voer('quote_no_response', { days: 7 });
    expect(bevindingen).toHaveLength(1);
    expect(bevindingen[0]?.entiteit).toBe('package-quotes');
  });

  it('meldt een offerte niet zolang de wachttijd nog niet om is', () => {
    handle.raw
      .prepare(
        `INSERT INTO package_quotes (number, status, sent_at, total_cents)
         VALUES ('O26002', 'verstuurd', '2026-09-05 10:00:00', 1250000)`,
      )
      .run();

    expect(voer('quote_no_response', { days: 7 })).toHaveLength(0);
  });

  it('meldt een offerte waarvan de geldigheid afloopt', () => {
    handle.raw
      .prepare(
        `INSERT INTO package_quotes (number, status, valid_until, total_cents)
         VALUES ('O26003', 'verstuurd', '2026-09-12', 1250000)`,
      )
      .run();

    expect(voer('quote_expiring', { days: 7 })).toHaveLength(1);
  });

  it('meldt een offerte waarover al is beslist niet meer', () => {
    handle.raw
      .prepare(
        `INSERT INTO package_quotes (number, status, valid_until, decided_at, total_cents)
         VALUES ('O26004', 'geaccepteerd', '2026-09-12', '2026-09-01', 1250000)`,
      )
      .run();

    expect(voer('quote_expiring', { days: 7 })).toHaveLength(0);
  });

  it('meldt een taak die over datum staat', () => {
    handle.raw
      .prepare(
        `INSERT INTO activities (type, subject, status, due_at, assigned_user_id)
         VALUES ('bellen', 'Meesters nabellen', 'open', '2026-09-01 09:00:00', 1)`,
      )
      .run();

    const bevindingen = voer('followup_overdue');
    expect(bevindingen).toHaveLength(1);
    expect(bevindingen[0]?.titel).toContain('Meesters nabellen');
  });

  it('meldt een afgeronde taak niet', () => {
    handle.raw
      .prepare(
        `INSERT INTO activities (type, subject, status, due_at, completed_at)
         VALUES ('bellen', 'Al gedaan', 'afgerond', '2026-09-01 09:00:00', '2026-09-02 09:00:00')`,
      )
      .run();

    expect(voer('followup_overdue')).toHaveLength(0);
  });

  it('meldt een klant met projecten waar al lang geen contact mee is', () => {
    handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Bouwbedrijf Meesters B.V.')").run();
    handle.raw
      .prepare("INSERT INTO projects (name, organization_id, unit_count) VALUES ('Fase 3', 1, 18)")
      .run();

    const bevindingen = voer('contact_dormant', { days: 180 });
    expect(bevindingen).toHaveLength(1);
    expect(bevindingen[0]?.tekst).toContain('geen enkel contactmoment');
  });

  it('meldt een klant met recent contact niet', () => {
    handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Bouwbedrijf Meesters B.V.')").run();
    handle.raw
      .prepare("INSERT INTO projects (name, organization_id, unit_count) VALUES ('Fase 3', 1, 18)")
      .run();
    handle.raw
      .prepare(
        `INSERT INTO activities (type, subject, status, created_at)
         VALUES ('bellen', 'Bijgepraat', 'afgerond', '2026-09-01 09:00:00')`,
      )
      .run();
    handle.raw
      .prepare(
        "INSERT INTO activity_links (activity_id, entity_key, record_id) VALUES (1, 'organizations', 1)",
      )
      .run();

    expect(voer('contact_dormant', { days: 180 })).toHaveLength(0);
  });

  it('meldt een klant zonder projecten niet: die hoort er niet bij', () => {
    handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Ooit eens gebeld')").run();
    expect(voer('contact_dormant', { days: 180 })).toHaveLength(0);
  });

  it('meldt een begeleider zonder rooster als datakwaliteit', () => {
    handle.raw
      .prepare(
        `INSERT INTO users (name, initials, email, password_hash, is_kopersbegeleider)
         VALUES ('Zonder rooster', 'ZR', 'z@t.local', 'x', 1)`,
      )
      .run();

    const bevindingen = voer('data_quality');
    expect(bevindingen.some((bevinding) => bevinding.dedupeKey === 'kwaliteit:rooster')).toBe(true);
  });

  it('meldt ontbrekende feestdagen als datakwaliteit', () => {
    const bevindingen = voer('data_quality');
    expect(bevindingen.some((bevinding) => bevinding.dedupeKey === 'kwaliteit:feestdagen:2026')).toBe(
      true,
    );
  });
});

/** Maakt een project met één showroomfase en geeft het id terug. */
function maakProjectMetFase(naam: string, van: string, tot: string): number {
  handle.raw
    .prepare("INSERT OR IGNORE INTO picklists (key, name) VALUES ('projectfase', 'Projectfase')")
    .run();
  handle.raw
    .prepare(
      `INSERT INTO picklist_items (picklist_id, value, label)
       SELECT (SELECT id FROM picklists WHERE key = 'projectfase'), 'showroom', 'Showroom'
        WHERE NOT EXISTS (
          SELECT 1 FROM picklist_items i JOIN picklists p ON p.id = i.picklist_id
           WHERE p.key = 'projectfase' AND i.value = 'showroom'
        )`,
    )
    .run();

  const project = handle.raw
    .prepare('INSERT INTO projects (name, unit_count, counts_as_showroom) VALUES (?, 24, 1)')
    .run(naam);
  const projectId = Number(project.lastInsertRowid);

  handle.raw
    .prepare(
      `INSERT INTO project_phases (project_id, phase_type_id, start_date, end_date, is_capacity_load)
       VALUES (?, (SELECT i.id FROM picklist_items i JOIN picklists p ON p.id = i.picklist_id
                    WHERE p.key = 'projectfase' AND i.value = 'showroom'), ?, ?, 1)`,
    )
    .run(projectId, van, tot);

  return projectId;
}
