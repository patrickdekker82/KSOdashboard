import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { columnsFrom, compileFilter, compileSort, FilterError } from './filter.ts';
import { openDatabase } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';

const columns = columnsFrom({
  naam: 'name',
  plaats: 'city',
  aantal: 'unit_count',
  datum: 'start_date',
  eigenaar: 'owner_user_id',
});

describe('filter naar SQL', () => {
  it('levert 1 = 1 voor een leeg filter', () => {
    expect(compileFilter(null, columns)).toEqual({ sql: '1 = 1', params: [] });
    expect(compileFilter({ op: 'and', children: [] }, columns).sql).toBe('1 = 1');
  });

  it('bindt elke waarde als parameter, nooit als tekst in de SQL', () => {
    const result = compileFilter(
      { field: 'naam', operator: 'eq', value: "Robert'); DROP TABLE users;--" },
      columns,
    );
    expect(result.sql).toBe('name = ?');
    expect(result.params).toEqual(["Robert'); DROP TABLE users;--"]);
    expect(result.sql).not.toContain('DROP');
  });

  it('vertaalt de vergelijkende operatoren', () => {
    expect(compileFilter({ field: 'aantal', operator: 'gt', value: 10 }, columns)).toEqual({
      sql: 'unit_count > ?',
      params: [10],
    });
    expect(compileFilter({ field: 'aantal', operator: 'lte', value: 5 }, columns).sql).toBe(
      'unit_count <= ?',
    );
  });

  it('behandelt null bij eq en neq als IS NULL', () => {
    expect(compileFilter({ field: 'eigenaar', operator: 'eq', value: null }, columns)).toEqual({
      sql: 'owner_user_id IS NULL',
      params: [],
    });
    expect(compileFilter({ field: 'eigenaar', operator: 'neq', value: null }, columns).sql).toBe(
      'owner_user_id IS NOT NULL',
    );
  });

  it('laat neq ook rijen met NULL meenemen', () => {
    // Zonder de NULL-tak zou "niet gelijk aan X" rijen zonder waarde verbergen.
    const result = compileFilter({ field: 'plaats', operator: 'neq', value: 'Breda' }, columns);
    expect(result.sql).toBe('(city IS NULL OR city <> ?)');
  });

  it('ontsnapt jokertekens in contains en startsWith', () => {
    const result = compileFilter({ field: 'naam', operator: 'contains', value: '100%_korting' }, columns);
    expect(result.params).toEqual(['%100\\%\\_korting%']);
    expect(result.sql).toContain("ESCAPE '\\'");
  });

  it('vertaalt in en notIn met evenveel plaatshouders als waarden', () => {
    const result = compileFilter({ field: 'plaats', operator: 'in', value: ['Breda', 'Tilburg'] }, columns);
    expect(result.sql).toBe('city IN (?, ?)');
    expect(result.params).toEqual(['Breda', 'Tilburg']);
  });

  it('geeft een lege in-lijst een eenduidige betekenis', () => {
    expect(compileFilter({ field: 'plaats', operator: 'in', value: [] }, columns).sql).toBe('1 = 0');
    expect(compileFilter({ field: 'plaats', operator: 'notIn', value: [] }, columns).sql).toBe('1 = 1');
  });

  it('vertaalt isEmpty en isNotEmpty', () => {
    expect(compileFilter({ field: 'plaats', operator: 'isEmpty' }, columns).sql).toBe(
      "(city IS NULL OR city = '')",
    );
    expect(compileFilter({ field: 'plaats', operator: 'isNotEmpty' }, columns).sql).toBe(
      "(city IS NOT NULL AND city <> '')",
    );
  });

  it('vertaalt between met precies twee waarden', () => {
    expect(compileFilter({ field: 'aantal', operator: 'between', value: [10, 30] }, columns)).toEqual({
      sql: 'unit_count BETWEEN ? AND ?',
      params: [10, 30],
    });
    expect(() =>
      compileFilter({ field: 'aantal', operator: 'between', value: [10] }, columns),
    ).toThrow(FilterError);
  });

  it('accepteert alleen bekende perioden bij dateWithin', () => {
    expect(compileFilter({ field: 'datum', operator: 'dateWithin', value: '-30d' }, columns).sql).toBe(
      "start_date >= date('now', '-30 days')",
    );
    expect(compileFilter({ field: 'datum', operator: 'dateWithin', value: 'vandaag' }, columns).sql).toBe(
      "start_date >= date('now')",
    );
    expect(() =>
      compileFilter({ field: 'datum', operator: 'dateWithin', value: "'); DROP TABLE users;--" }, columns),
    ).toThrow(FilterError);
  });

  it('nest and en or correct', () => {
    const result = compileFilter(
      {
        op: 'and',
        children: [
          { field: 'plaats', operator: 'eq', value: 'Breda' },
          {
            op: 'or',
            children: [
              { field: 'aantal', operator: 'gte', value: 20 },
              { field: 'naam', operator: 'contains', value: 'CECI' },
            ],
          },
        ],
      },
      columns,
    );
    expect(result.sql).toBe('(city = ? AND (unit_count >= ? OR name LIKE ? ESCAPE \'\\\'))');
    expect(result.params).toEqual(['Breda', 20, '%CECI%']);
  });
});

describe('beveiliging van veldnamen', () => {
  it('weigert een onbekend veld', () => {
    expect(() => compileFilter({ field: 'password_hash', operator: 'eq', value: 'x' }, columns)).toThrow(
      /Onbekend veld/,
    );
  });

  it('weigert een veldnaam die SQL probeert binnen te smokkelen', () => {
    expect(() =>
      compileFilter({ field: 'name FROM users WHERE 1=1--', operator: 'eq', value: 'x' }, columns),
    ).toThrow(FilterError);
  });

  it('staat maatwerkvelden toe via json_extract, maar alleen met een veilige sleutel', () => {
    expect(compileFilter({ field: 'cf_bouwstroom', operator: 'eq', value: 'A' }, columns).sql).toBe(
      "json_extract(custom_fields, '$.cf_bouwstroom') = ?",
    );
    expect(() => compileFilter({ field: "cf_x'); DROP--", operator: 'eq', value: 'A' }, columns)).toThrow(
      FilterError,
    );
  });

  it('weigert een te diep genest filter', () => {
    let node: never | { op: 'and'; children: unknown[] } = { op: 'and', children: [] };
    for (let i = 0; i < 12; i += 1) node = { op: 'and', children: [node] };
    expect(() => compileFilter(node as never, columns)).toThrow(/te diep genest/);
  });

  it('controleert ook sorteervelden tegen de whitelist', () => {
    expect(compileSort([{ field: 'naam', direction: 'desc' }], columns)).toBe('name DESC');
    expect(() => compileSort([{ field: 'password_hash' }], columns)).toThrow(FilterError);
    expect(compileSort([], columns)).toBe('id DESC');
  });
});

describe('de gegenereerde SQL draait ook echt', () => {
  it('voert een samengesteld filter uit tegen SQLite', () => {
    const directory = mkdtempSync(join(tmpdir(), 'showroom-filter-'));
    const handle = openDatabase(join(directory, 'showroom.db'));
    try {
      runMigrations(handle);
      handle.raw
        .prepare("INSERT INTO projects (name, city, unit_count) VALUES ('Plan CECI', 'Breda', 24)")
        .run();
      handle.raw
        .prepare("INSERT INTO projects (name, city, unit_count) VALUES ('Meesters', 'Tilburg', 18)")
        .run();

      const { sql, params } = compileFilter(
        {
          op: 'and',
          children: [
            { field: 'plaats', operator: 'in', value: ['Breda', 'Tilburg'] },
            { field: 'aantal', operator: 'gte', value: 20 },
          ],
        },
        columns,
      );
      const rows = handle.raw
        .prepare(`SELECT name FROM projects WHERE ${sql}`)
        .all(...(params as never[])) as Array<{ name: string }>;
      expect(rows.map((row) => row.name)).toEqual(['Plan CECI']);
    } finally {
      handle.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
