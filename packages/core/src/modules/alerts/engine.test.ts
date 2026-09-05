/**
 * Tests voor de signaleringsmotor (hoofdstuk 8.2).
 *
 * Het aanmaken van een melding is het makkelijke deel. Waar het misgaat is
 * daarna: een uurlijkse controle die elke keer dezelfde melding opnieuw
 * aanmaakt, of meldingen die blijven staan nadat de situatie is opgelost. Beide
 * maken dat mensen het dashboard binnen een maand niet meer lezen, en beide
 * staan hieronder.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import { laadMeldingen, telMeldingen, voerControleUit } from './engine.ts';
import { REGELS } from './rules.ts';

type Rij = Record<string, unknown>;

let directory: string;
let handle: DatabaseHandle;

const NU = new Date('2026-09-07T09:00:00Z');

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-alerts-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);

  handle.raw
    .prepare(
      "INSERT INTO users (name, initials, email, password_hash) VALUES ('Dennis', 'DM', 'd@t.local', 'x')",
    )
    .run();
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Zet een regel klaar van een type dat we in de test zelf voeden. */
function regel(type: string, params: Record<string, unknown> = {}, ernst = 'let_op'): number {
  const resultaat = handle.raw
    .prepare('INSERT INTO alert_rules (name, type, params, severity) VALUES (?, ?, ?, ?)')
    .run(`Regel ${type}`, type, JSON.stringify(params), ernst);
  return Number(resultaat.lastInsertRowid);
}

const meldingen = (): Rij[] =>
  handle.raw.prepare('SELECT * FROM alerts ORDER BY id').all() as Rij[];

describe('meldingen aanmaken, bijwerken en sluiten', () => {
  // Het projecttype gebruiken we hier omdat het van één rij in de database
  // afhangt: zo is precies te sturen wanneer de bevinding er wel en niet is.
  function projectZonderPlanning(naam: string, woningen = 20): number {
    const resultaat = handle.raw
      .prepare('INSERT INTO projects (name, unit_count, counts_as_showroom) VALUES (?, ?, 1)')
      .run(naam, woningen);
    return Number(resultaat.lastInsertRowid);
  }

  it('maakt een melding aan voor een nieuwe bevinding', () => {
    regel('project_unplanned');
    projectZonderPlanning('Plan Zuidhoek');

    const uitkomst = voerControleUit(handle, NU);

    expect(uitkomst.nieuw).toBe(1);
    expect(meldingen()).toHaveLength(1);
    expect(meldingen()[0]).toMatchObject({ status: 'open', severity: 'let_op' });
    expect(String(meldingen()[0]?.title)).toContain('Plan Zuidhoek');
  });

  // Dit is het gedrag dat een dashboard onleesbaar maakt als het ontbreekt:
  // elk uur dezelfde melding opnieuw.
  it('maakt bij een tweede controle geen tweede melding voor dezelfde situatie', () => {
    regel('project_unplanned');
    projectZonderPlanning('Plan Zuidhoek');

    voerControleUit(handle, NU);
    const tweede = voerControleUit(handle, new Date('2026-09-07T10:00:00Z'));

    expect(tweede.nieuw).toBe(0);
    expect(tweede.bijgewerkt).toBe(1);
    expect(meldingen()).toHaveLength(1);
  });

  it('schuift "laatst gezien" op zonder "voor het eerst gezien" aan te raken', () => {
    regel('project_unplanned');
    projectZonderPlanning('Plan Zuidhoek');

    voerControleUit(handle, NU);
    const eerste = meldingen()[0]!;

    voerControleUit(handle, new Date('2026-09-09T10:00:00Z'));
    const daarna = meldingen()[0]!;

    expect(daarna.first_seen_at).toBe(eerste.first_seen_at);
    expect(String(daarna.last_seen_at)).toBe('2026-09-09 10:00:00');
  });

  it('sluit een melding zodra de situatie is opgelost', () => {
    regel('project_unplanned');
    const projectId = projectZonderPlanning('Plan Zuidhoek');
    voerControleUit(handle, NU);

    // Een fase toevoegen lost het op.
    handle.raw.prepare("INSERT INTO picklists (key, name) VALUES ('projectfase', 'Fase')").run();
    const fase = handle.raw
      .prepare(
        `INSERT INTO picklist_items (picklist_id, value, label)
         VALUES ((SELECT id FROM picklists WHERE key = 'projectfase'), 'showroom', 'Showroom')`,
      )
      .run();
    handle.raw
      .prepare(
        `INSERT INTO project_phases (project_id, phase_type_id, start_date, end_date, is_capacity_load)
         VALUES (?, ?, '2026-10-05', '2026-11-27', 1)`,
      )
      .run(projectId, Number(fase.lastInsertRowid));

    const tweede = voerControleUit(handle, new Date('2026-09-08T09:00:00Z'));

    expect(tweede.opgelost).toBe(1);
    expect(meldingen()[0]?.status).toBe('opgelost');
  });

  // Er is per situatie hooguit één melding (unieke index op dedupe_key), dus
  // een terugkerend probleem heropent dezelfde melding. "Voor het eerst gezien"
  // gaat mee naar dat moment: "speelt al sinds 7 september" zou onwaar zijn
  // voor iets dat op 8 september was opgelost.
  it('heropent een melding als een opgeloste situatie terugkomt', () => {
    regel('project_unplanned');
    const projectId = projectZonderPlanning('Plan Zuidhoek');
    voerControleUit(handle, NU);

    handle.raw.prepare('UPDATE projects SET unit_count = 0 WHERE id = ?').run(projectId);
    voerControleUit(handle, new Date('2026-09-08T09:00:00Z'));
    expect(meldingen()[0]?.status).toBe('opgelost');

    handle.raw.prepare('UPDATE projects SET unit_count = 20 WHERE id = ?').run(projectId);
    const derde = voerControleUit(handle, new Date('2026-09-09T09:00:00Z'));

    expect(derde.nieuw).toBe(1);
    expect(meldingen()).toHaveLength(1);
    expect(meldingen()[0]).toMatchObject({
      status: 'open',
      first_seen_at: '2026-09-09 09:00:00',
    });
  });

  // Wie het vorige voorval had weggeklikt, hoort het nieuwe wel te zien.
  it('laat een bevestiging vervallen bij het heropenen', () => {
    regel('project_unplanned');
    const projectId = projectZonderPlanning('Plan Zuidhoek');
    voerControleUit(handle, NU);
    handle.raw
      .prepare("UPDATE alerts SET status = 'bevestigd', acknowledged_by = 1, acknowledged_at = ?")
      .run('2026-09-07 10:00:00');

    handle.raw.prepare('UPDATE projects SET unit_count = 0 WHERE id = ?').run(projectId);
    voerControleUit(handle, new Date('2026-09-08T09:00:00Z'));
    handle.raw.prepare('UPDATE projects SET unit_count = 20 WHERE id = ?').run(projectId);
    voerControleUit(handle, new Date('2026-09-09T09:00:00Z'));

    expect(meldingen()[0]).toMatchObject({
      status: 'open',
      acknowledged_by: null,
      acknowledged_at: null,
    });
  });

  // Zonder voorvoegsel zouden twee regels die dezelfde sleutel kiezen elkaars
  // melding overschrijven, en de unieke index maakt daar een harde fout van.
  it('zet het regeltype voor de ontdubbelsleutel', () => {
    regel('project_unplanned');
    projectZonderPlanning('Plan Zuidhoek');
    voerControleUit(handle, NU);

    expect(String(meldingen()[0]?.dedupe_key)).toBe('project_unplanned:ongepland:1');
  });

  it('laat een bevestigde melding staan zolang de situatie er is', () => {
    regel('project_unplanned');
    projectZonderPlanning('Plan Zuidhoek');
    voerControleUit(handle, NU);

    handle.raw
      .prepare("UPDATE alerts SET status = 'bevestigd', acknowledged_by = 1 WHERE id = 1")
      .run();

    const tweede = voerControleUit(handle, new Date('2026-09-08T09:00:00Z'));

    expect(tweede.nieuw).toBe(0);
    expect(meldingen()[0]?.status).toBe('bevestigd');
  });

  it('werkt de tekst bij als de situatie verandert maar dezelfde blijft', () => {
    regel('project_unplanned');
    const projectId = projectZonderPlanning('Plan Zuidhoek', 20);
    voerControleUit(handle, NU);
    expect(String(meldingen()[0]?.body)).toContain('20 woningen');

    handle.raw.prepare('UPDATE projects SET unit_count = 45 WHERE id = ?').run(projectId);
    voerControleUit(handle, new Date('2026-09-08T09:00:00Z'));

    expect(meldingen()).toHaveLength(1);
    expect(String(meldingen()[0]?.body)).toContain('45 woningen');
  });

  it('slaat een uitgeschakelde regel over', () => {
    const id = regel('project_unplanned');
    handle.raw.prepare('UPDATE alert_rules SET active = 0 WHERE id = ?').run(id);
    projectZonderPlanning('Plan Zuidhoek');

    expect(voerControleUit(handle, NU).gedraaid).toBe(0);
    expect(meldingen()).toHaveLength(0);
  });

  it('noemt regeltypes waarvoor nog geen code bestaat', () => {
    regel('backup_failed');
    const uitkomst = voerControleUit(handle, NU);

    expect(uitkomst.onbekendeTypes).toEqual(['backup_failed']);
    expect(uitkomst.gedraaid).toBe(0);
  });

  // Eén kapotte regel mag de rest niet meenemen: een dashboard met zeventien
  // van de achttien regels is beter dan een leeg dashboard.
  it('laat de andere regels doorlopen als er een omvalt', () => {
    handle.raw
      .prepare(
        "INSERT INTO alert_rules (name, type, params, severity) VALUES ('Stuk', 'contact_dormant', ?, 'info')",
      )
      .run('{"days": "geen getal"}');
    regel('project_unplanned');
    projectZonderPlanning('Plan Zuidhoek');

    const uitkomst = voerControleUit(handle, NU);

    expect(uitkomst.nieuw).toBe(1);
    expect(uitkomst.gedraaid).toBe(2);
  });

  it('draait desgevraagd maar één regel', () => {
    const alleen = regel('project_unplanned');
    regel('data_quality', {}, 'info');
    projectZonderPlanning('Plan Zuidhoek');

    const uitkomst = voerControleUit(handle, NU, alleen);

    expect(uitkomst.gedraaid).toBe(1);
    expect(uitkomst.regels[0]?.regelId).toBe(alleen);
  });

  it('legt vast wanneer een regel voor het laatst is gedraaid', () => {
    const id = regel('project_unplanned');
    voerControleUit(handle, NU);

    const rij = handle.raw.prepare('SELECT last_checked_at FROM alert_rules WHERE id = ?').get(id) as {
      last_checked_at: string | null;
    };
    expect(rij.last_checked_at).not.toBeNull();
  });
});

describe('meldingen ophalen', () => {
  beforeEach(() => {
    regel('project_unplanned');
    handle.raw
      .prepare('INSERT INTO projects (name, unit_count, counts_as_showroom) VALUES (?, ?, 1)')
      .run('Plan Zuidhoek', 20);
    voerControleUit(handle, NU);
  });

  it('geeft open meldingen terug', () => {
    expect(laadMeldingen(handle, {}, NU)).toHaveLength(1);
  });

  it('verbergt een melding die is uitgesteld tot later', () => {
    handle.raw
      .prepare("UPDATE alerts SET status = 'uitgesteld', snoozed_until = '2026-09-20 00:00:00'")
      .run();

    expect(laadMeldingen(handle, {}, NU)).toHaveLength(0);
  });

  it('laat een melding weer zien zodra het uitstel voorbij is', () => {
    handle.raw
      .prepare("UPDATE alerts SET status = 'uitgesteld', snoozed_until = '2026-09-20 00:00:00'")
      .run();

    expect(laadMeldingen(handle, {}, new Date('2026-09-21T09:00:00Z'))).toHaveLength(1);
  });

  it('filtert op ernst', () => {
    expect(laadMeldingen(handle, { ernst: ['urgent'] }, NU)).toHaveLength(0);
    expect(laadMeldingen(handle, { ernst: ['let_op'] }, NU)).toHaveLength(1);
  });

  it('telt per ernst voor de kopbalk', () => {
    expect(telMeldingen(handle, NU)).toEqual({ urgent: 0, let_op: 1, info: 0 });
  });

  it('telt een uitgestelde melding niet mee in de kopbalk', () => {
    handle.raw
      .prepare("UPDATE alerts SET status = 'uitgesteld', snoozed_until = '2026-09-20 00:00:00'")
      .run();
    expect(telMeldingen(handle, NU)).toEqual({ urgent: 0, let_op: 0, info: 0 });
  });
});

describe('de regellijst', () => {
  // De seed zet achttien regels klaar. Als er een type bij komt zonder code,
  // hoort dat op te vallen — niet stilletjes nooit af te gaan.
  it('kent elk regeltype uit de seed, behalve die van een latere fase', () => {
    const uitTeStellen = new Set(['backup_failed']);
    const seedTypes = [
      'capacity_gap',
      'capacity_overload',
      'capacity_understaffed',
      'absence_conflict',
      'absence_overlap',
      'allocation_ending',
      'sick_leave_open',
      'project_single_guide',
      'project_unplanned',
      'project_phase_missing',
      'opportunity_stale',
      'opportunity_closing',
      'quote_no_response',
      'quote_expiring',
      'followup_overdue',
      'contact_dormant',
      'data_quality',
      'backup_failed',
    ];

    for (const type of seedTypes) {
      if (uitTeStellen.has(type)) {
        expect(REGELS.has(type)).toBe(false);
        continue;
      }
      expect(REGELS.has(type), `regeltype ${type} heeft geen code`).toBe(true);
    }
  });
});
