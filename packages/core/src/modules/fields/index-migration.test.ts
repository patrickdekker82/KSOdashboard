import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import {
  buildDropStatements,
  buildIndexStatements,
  dropIndex,
  ensureIndex,
  IndexFout,
  removeFieldData,
  sqliteTypeFor,
} from './index-migration.ts';

const TABELLEN = ['projects', 'opportunities', 'organizations'];

let directory: string;
let handle: DatabaseHandle;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-index-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

// table_xinfo toont ook gegenereerde kolommen; table_info laat ze weg.
const kolommen = (table: string): string[] =>
  (handle.raw.prepare(`PRAGMA table_xinfo(${table})`).all() as Array<{ name: string }>).map(
    (rij) => rij.name,
  );

const indexen = (table: string): string[] =>
  (
    handle.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?")
      .all(table) as Array<{ name: string }>
  ).map((rij) => rij.name);

describe('SQL samenstellen', () => {
  it('bouwt de gegenereerde kolom en de index zoals hoofdstuk 3.3 beschrijft', () => {
    const statements = buildIndexStatements('opportunities', 'cf_bouwstroom', 'text', TABELLEN);
    expect(statements.kolom).toBe(
      "ALTER TABLE opportunities ADD COLUMN cf_bouwstroom_idx TEXT " +
        "GENERATED ALWAYS AS (json_extract(custom_fields, '$.cf_bouwstroom')) VIRTUAL",
    );
    expect(statements.index).toBe(
      'CREATE INDEX IF NOT EXISTS idx_opportunities_cf_bouwstroom ON opportunities(cf_bouwstroom_idx)',
    );
  });

  it('kiest een passend SQLite-type per veldtype', () => {
    expect(sqliteTypeFor('currency')).toBe('REAL');
    expect(sqliteTypeFor('integer')).toBe('INTEGER');
    expect(sqliteTypeFor('relation')).toBe('INTEGER');
    expect(sqliteTypeFor('text')).toBe('TEXT');
    expect(sqliteTypeFor('date')).toBe('TEXT');
  });

  it('bouwt ook de opruimstatements', () => {
    const statements = buildDropStatements('projects', 'cf_bouwstroom', TABELLEN);
    expect(statements.index).toBe('DROP INDEX IF EXISTS idx_projects_cf_bouwstroom');
    expect(statements.kolom).toBe('ALTER TABLE projects DROP COLUMN cf_bouwstroom_idx');
  });
});

describe('dit is de enige plek waar DDL uit invoer ontstaat', () => {
  it('weigert een tabel die niet in het register staat', () => {
    expect(() => buildIndexStatements('users', 'cf_x', 'text', TABELLEN)).toThrow(IndexFout);
    expect(() => buildIndexStatements('sqlite_master', 'cf_x', 'text', TABELLEN)).toThrow(
      /Onbekende tabel/,
    );
  });

  it('weigert een tabelnaam die SQL probeert binnen te smokkelen', () => {
    expect(() =>
      buildIndexStatements('projects; DROP TABLE users;--', 'cf_x', 'text', TABELLEN),
    ).toThrow(IndexFout);
  });

  it('weigert een veldsleutel die niet aan het patroon voldoet', () => {
    for (const sleutel of [
      'bouwstroom',
      'cf_Bouwstroom',
      'cf_bouw-stroom',
      "cf_x'); DROP TABLE users;--",
      'cf_',
      '1cf_x',
    ]) {
      expect(() => buildIndexStatements('projects', sleutel, 'text', TABELLEN), sleutel).toThrow(
        IndexFout,
      );
    }
  });

  it('accepteert een nette sleutel', () => {
    expect(() => buildIndexStatements('projects', 'cf_bouwstroom_2', 'text', TABELLEN)).not.toThrow();
  });
});

describe('tegen een echte database', () => {
  it('legt de kolom en de index aan en maakt filteren mogelijk', () => {
    ensureIndex(handle, 'projects', 'cf_bouwstroom', 'text', TABELLEN);

    expect(kolommen('projects')).toContain('cf_bouwstroom_idx');
    expect(indexen('projects')).toContain('idx_projects_cf_bouwstroom');

    handle.raw
      .prepare("INSERT INTO projects (name, custom_fields) VALUES ('Plan A', json('{\"cf_bouwstroom\":\"A\"}'))")
      .run();
    handle.raw
      .prepare("INSERT INTO projects (name, custom_fields) VALUES ('Plan B', json('{\"cf_bouwstroom\":\"B\"}'))")
      .run();

    const rijen = handle.raw
      .prepare('SELECT name FROM projects WHERE cf_bouwstroom_idx = ?')
      .all('A') as Array<{ name: string }>;
    expect(rijen.map((rij) => rij.name)).toEqual(['Plan A']);
  });

  it('vult de kolom ook voor rijen die er al stonden', () => {
    // VIRTUAL betekent: bij het lezen berekend, dus bestaande rijen doen mee
    // zonder dat de tabel herschreven hoeft te worden.
    handle.raw
      .prepare("INSERT INTO projects (name, custom_fields) VALUES ('Bestaand', json('{\"cf_bouwstroom\":\"C\"}'))")
      .run();

    ensureIndex(handle, 'projects', 'cf_bouwstroom', 'text', TABELLEN);

    const rij = handle.raw
      .prepare('SELECT cf_bouwstroom_idx AS waarde FROM projects WHERE name = ?')
      .get('Bestaand') as { waarde: string };
    expect(rij.waarde).toBe('C');
  });

  it('gebruikt de index ook echt in het queryplan', () => {
    ensureIndex(handle, 'projects', 'cf_bouwstroom', 'text', TABELLEN);
    const plan = handle.raw
      .prepare('EXPLAIN QUERY PLAN SELECT name FROM projects WHERE cf_bouwstroom_idx = ?')
      .all('A') as Array<{ detail: string }>;
    expect(plan.map((rij) => rij.detail).join(' ')).toContain('idx_projects_cf_bouwstroom');
  });

  it('is idempotent: twee keer aanleggen doet geen kwaad', () => {
    ensureIndex(handle, 'projects', 'cf_bouwstroom', 'text', TABELLEN);
    expect(() => ensureIndex(handle, 'projects', 'cf_bouwstroom', 'text', TABELLEN)).not.toThrow();
    expect(kolommen('projects').filter((naam) => naam === 'cf_bouwstroom_idx')).toHaveLength(1);
  });

  it('ruimt de index en de kolom weer op', () => {
    ensureIndex(handle, 'projects', 'cf_bouwstroom', 'text', TABELLEN);
    dropIndex(handle, 'projects', 'cf_bouwstroom', TABELLEN);

    expect(kolommen('projects')).not.toContain('cf_bouwstroom_idx');
    expect(indexen('projects')).not.toContain('idx_projects_cf_bouwstroom');
  });

  it('kan opruimen wat er niet is', () => {
    expect(() => dropIndex(handle, 'projects', 'cf_bestaat_niet', TABELLEN)).not.toThrow();
  });
});

describe('definitief verwijderen inclusief data', () => {
  beforeEach(() => {
    handle.raw
      .prepare(
        "INSERT INTO projects (name, custom_fields) VALUES ('Plan A', json('{\"cf_bouwstroom\":\"A\",\"cf_blijft\":\"ja\"}'))",
      )
      .run();
    handle.raw
      .prepare("INSERT INTO projects (name, custom_fields) VALUES ('Plan B', json('{\"cf_blijft\":\"ja\"}'))")
      .run();
  });

  it('haalt de sleutel uit elke rij en laat de rest staan', () => {
    const resultaat = removeFieldData(handle, 'projects', 'cf_bouwstroom', TABELLEN);
    expect(resultaat.rijen).toBe(1); // alleen Plan A had de sleutel

    const rijen = handle.raw
      .prepare('SELECT name, custom_fields FROM projects ORDER BY name')
      .all() as Array<{ name: string; custom_fields: string }>;
    expect(JSON.parse(rijen[0]!.custom_fields)).toEqual({ cf_blijft: 'ja' });
    expect(JSON.parse(rijen[1]!.custom_fields)).toEqual({ cf_blijft: 'ja' });
  });

  it('ruimt eerst de index op, zodat de kolom niet naar weg data wijst', () => {
    ensureIndex(handle, 'projects', 'cf_bouwstroom', 'text', TABELLEN);
    removeFieldData(handle, 'projects', 'cf_bouwstroom', TABELLEN);
    expect(kolommen('projects')).not.toContain('cf_bouwstroom_idx');
    expect(indexen('projects')).not.toContain('idx_projects_cf_bouwstroom');
  });

  it('weigert een tabel of sleutel die niet deugt', () => {
    expect(() => removeFieldData(handle, 'users', 'cf_x', TABELLEN)).toThrow(IndexFout);
    expect(() => removeFieldData(handle, 'projects', 'password_hash', TABELLEN)).toThrow(IndexFout);
  });
});
