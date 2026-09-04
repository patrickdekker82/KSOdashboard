import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, integrityCheck, transaction, type DatabaseHandle } from './client.ts';
import { appliedMigrations, applyViews, runMigrations, schemaVersion } from './migrate.ts';

let directory: string;
let handle: DatabaseHandle;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-test-'));
  handle = openDatabase(join(directory, 'showroom.db'));
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

const tableNames = (): string[] =>
  (
    handle.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);

describe('migraties', () => {
  it('draait het initiele schema en registreert dat', () => {
    const result = runMigrations(handle);
    expect(result.applied).toEqual(['0001_initieel.sql']);
    expect(appliedMigrations(handle).map((m) => m.name)).toEqual(['0001_initieel.sql']);
    expect(schemaVersion(handle)).toBe('0001_initieel.sql');
  });

  it('is idempotent: een tweede keer draaien doet niets', () => {
    runMigrations(handle);
    const second = runMigrations(handle);
    expect(second.applied).toEqual([]);
    expect(second.alreadyCurrent).toBe(true);
  });

  it('maakt alle kerntabellen uit hoofdstuk 4 aan', () => {
    runMigrations(handle);
    const tables = tableNames();
    for (const table of [
      'users',
      'work_schedules',
      'sessions',
      'audit_log',
      'settings',
      'field_definitions',
      'picklists',
      'picklist_items',
      'layout_sections',
      'saved_views',
      'absence_types',
      'absences',
      'leave_balances',
      'holidays',
      'allocation_types',
      'capacity_allocations',
      'organizations',
      'contacts',
      'disciplines',
      'opportunities',
      'opportunity_lines',
      'projects',
      'project_phases',
      'project_assignments',
      'closure_periods',
      'products',
      'packages',
      'package_items',
      'package_quotes',
      'package_quote_lines',
      'activities',
      'email_templates',
      'email_messages',
      'ai_presets',
      'alert_rules',
      'alerts',
      'attachments',
      'notifications',
    ]) {
      expect(tables, `tabel ${table} ontbreekt`).toContain(table);
    }
  });

  it('maakt de rapportage-views aan', () => {
    runMigrations(handle);
    applyViews(handle);
    const views = (
      handle.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(views).toContain('v_afwezigheid');
    expect(views).toContain('v_projecten');
    expect(views).toContain('v_kansen');
    expect(views).toContain('v_pipeline_per_fase');
  });

  it('laat elke view zonder fout bevragen op een lege database', () => {
    runMigrations(handle);
    applyViews(handle);
    const views = (
      handle.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'view'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(views.length).toBeGreaterThan(8);
    for (const view of views) {
      expect(() => handle.raw.prepare(`SELECT * FROM ${view} LIMIT 1`).all()).not.toThrow();
    }
  });

  it('komt door de integriteitscontrole', () => {
    runMigrations(handle);
    expect(integrityCheck(handle)).toEqual({ ok: true, problems: [] });
  });
});

describe('pragmas en transacties', () => {
  it('zet WAL, foreign keys en busy_timeout aan', () => {
    const journal = handle.raw.prepare('PRAGMA journal_mode').get() as Record<string, unknown>;
    expect(String(Object.values(journal)[0]).toLowerCase()).toBe('wal');

    const foreignKeys = handle.raw.prepare('PRAGMA foreign_keys').get() as Record<string, unknown>;
    expect(Number(Object.values(foreignKeys)[0])).toBe(1);

    const timeout = handle.raw.prepare('PRAGMA busy_timeout').get() as Record<string, unknown>;
    expect(Number(Object.values(timeout)[0])).toBe(5000);
  });

  it('dwingt foreign keys ook echt af', () => {
    runMigrations(handle);
    expect(() =>
      handle.raw
        .prepare('INSERT INTO work_schedules (user_id, valid_from) VALUES (?, ?)')
        .run(999, '2026-01-01'),
    ).toThrow();
  });

  it('draait een mislukte transactie terug', () => {
    runMigrations(handle);
    expect(() =>
      transaction(handle, () => {
        handle.raw
          .prepare("INSERT INTO disciplines (code, name) VALUES ('TEG', 'Tegelwerk')")
          .run();
        throw new Error('opzettelijke fout');
      }),
    ).toThrow('opzettelijke fout');

    const count = handle.raw.prepare('SELECT COUNT(*) AS n FROM disciplines').get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });
});

describe('zoeken via FTS5', () => {
  it('houdt de zoekindex bij op invoegen, wijzigen en verwijderen', () => {
    runMigrations(handle);
    handle.raw
      .prepare("INSERT INTO organizations (name, city) VALUES ('Bouwbedrijf Meesters', 'Tilburg')")
      .run();

    const gevonden = handle.raw
      .prepare("SELECT rowid FROM organizations_fts WHERE organizations_fts MATCH 'Meesters'")
      .all();
    expect(gevonden).toHaveLength(1);

    handle.raw.prepare("UPDATE organizations SET name = 'Bouwbedrijf Jansen'").run();
    expect(
      handle.raw
        .prepare("SELECT rowid FROM organizations_fts WHERE organizations_fts MATCH 'Meesters'")
        .all(),
    ).toHaveLength(0);
    expect(
      handle.raw
        .prepare("SELECT rowid FROM organizations_fts WHERE organizations_fts MATCH 'Jansen'")
        .all(),
    ).toHaveLength(1);

    handle.raw.prepare('DELETE FROM organizations').run();
    expect(
      handle.raw
        .prepare("SELECT rowid FROM organizations_fts WHERE organizations_fts MATCH 'Jansen'")
        .all(),
    ).toHaveLength(0);
  });
});
