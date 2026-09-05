/**
 * Tests voor de query-bouwer (hoofdstuk 11).
 *
 * Twee dingen moeten kloppen. Ten eerste dat er alleen SQL uit komt die uit
 * onze eigen bouwstenen bestaat: een veldnaam die de tabel niet heeft wordt
 * geweigerd, en waarden gaan als parameter mee en niet in de tekst. Ten tweede
 * dat een rapportage nooit iets kan wijzigen — ook niet als de bouwer zelf een
 * fout zou maken, want hij draait op dezelfde read-only verbinding als de
 * SQL-modus.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import type { Kolom } from '../export/xlsx.ts';
import {
  beschikbareEntiteiten,
  BouwerFout,
  bouwSql,
  draaiBouwer,
  kolommenVan,
  raadType,
} from './builder.ts';

let map: string;
let pad: string;
let handle: DatabaseHandle;

beforeEach(() => {
  map = mkdtempSync(join(tmpdir(), 'showroom-bouwer-'));
  pad = join(map, 'showroom.db');
  handle = openDatabase(pad);
  runMigrations(handle);

  handle.raw
    .prepare("INSERT INTO organizations (name, city) VALUES ('Kroon B.V.', 'Nieuwegein')")
    .run();
  handle.raw.prepare("INSERT INTO organizations (name, city) VALUES ('Jansen', 'Tilburg')").run();
  handle.raw
    .prepare(
      "INSERT INTO organizations (name, city, archived_at) VALUES ('Weg', 'Tilburg', datetime('now'))",
    )
    .run();
});

afterEach(() => {
  handle.close();
  rmSync(map, { recursive: true, force: true });
});

const KOLOMMEN: Kolom[] = [
  { sleutel: 'id', kop: 'id', type: 'getal' },
  { sleutel: 'name', kop: 'name', type: 'tekst' },
  { sleutel: 'city', kop: 'city', type: 'tekst' },
  { sleutel: 'archived_at', kop: 'archived_at', type: 'datum' },
];

describe('SQL bouwen', () => {
  it('maakt een eenvoudige selectie', () => {
    const gebouwd = bouwSql(
      {
        entiteit: 'organizations',
        kolommen: [{ veld: 'name', kop: 'Klant' }, { veld: 'city' }],
        sortering: [{ veld: 'name' }],
      },
      KOLOMMEN,
    );

    expect(gebouwd.sql).toContain('SELECT "name" AS "Klant", "city" AS "city"');
    expect(gebouwd.sql).toContain('FROM "organizations"');
    expect(gebouwd.sql).toContain('ORDER BY "name" ASC');
    expect(gebouwd.kolommen.map((kolom) => kolom.kop)).toEqual(['Klant', 'city']);
  });

  it('laat gearchiveerde records standaard weg', () => {
    const gebouwd = bouwSql(
      { entiteit: 'organizations', kolommen: [{ veld: 'name' }] },
      KOLOMMEN,
    );

    expect(gebouwd.sql).toContain('archived_at IS NULL');
  });

  it('neemt ze mee als daar uitdrukkelijk om gevraagd wordt', () => {
    const gebouwd = bouwSql(
      { entiteit: 'organizations', kolommen: [{ veld: 'name' }], metGearchiveerde: true },
      KOLOMMEN,
    );

    expect(gebouwd.sql).not.toContain('archived_at IS NULL');
  });

  it('zet filterwaarden als parameter neer en niet in de tekst', () => {
    const gebouwd = bouwSql(
      {
        entiteit: 'organizations',
        kolommen: [{ veld: 'name' }],
        filter: { field: 'city', operator: 'eq', value: "Tilburg'; DROP TABLE organizations--" },
      },
      KOLOMMEN,
    );

    expect(gebouwd.sql).not.toContain('DROP');
    expect(gebouwd.params).toContain("Tilburg'; DROP TABLE organizations--");
  });

  it('weigert een veld dat de tabel niet heeft', () => {
    expect(() =>
      bouwSql({ entiteit: 'organizations', kolommen: [{ veld: 'verzonnen' }] }, KOLOMMEN),
    ).toThrow(/bestaat niet/);
  });

  it('weigert een sortering op een veld dat niet bestaat', () => {
    expect(() =>
      bouwSql(
        {
          entiteit: 'organizations',
          kolommen: [{ veld: 'name' }],
          sortering: [{ veld: 'verzonnen' }],
        },
        KOLOMMEN,
      ),
    ).toThrow(BouwerFout);
  });

  it('weigert een filter op een veld dat niet bestaat', () => {
    expect(() =>
      bouwSql(
        {
          entiteit: 'organizations',
          kolommen: [{ veld: 'name' }],
          filter: { field: 'verzonnen', operator: 'eq', value: 1 },
        },
        KOLOMMEN,
      ),
    ).toThrow(/filter klopt niet/);
  });

  it('weigert een gegevenssoort die niet bestaat', () => {
    expect(() => bouwSql({ entiteit: 'geheim', kolommen: [{ veld: 'name' }] }, KOLOMMEN)).toThrow(
      /geen gegevenssoort/,
    );
  });

  it('weigert een rapportage zonder kolommen', () => {
    expect(() => bouwSql({ entiteit: 'organizations', kolommen: [] }, KOLOMMEN)).toThrow(
      /minstens één kolom/,
    );
  });
});

describe('groeperen', () => {
  it('bouwt een GROUP BY met een functie erover', () => {
    const gebouwd = bouwSql(
      {
        entiteit: 'organizations',
        kolommen: [
          { veld: 'city', kop: 'Plaats' },
          { veld: 'id', kop: 'Aantal', aggregatie: 'count' },
        ],
        groepering: ['city'],
      },
      KOLOMMEN,
    );

    expect(gebouwd.sql).toContain('COUNT("id") AS "Aantal"');
    expect(gebouwd.sql).toContain('GROUP BY "city"');
  });

  it('weigert een kolom die niet gegroepeerd is en geen functie heeft', () => {
    // SQLite laat dit toe en levert dan een willekeurige rij uit de groep op:
    // een getal dat klopt maar niets betekent.
    expect(() =>
      bouwSql(
        {
          entiteit: 'organizations',
          kolommen: [{ veld: 'city' }, { veld: 'name', kop: 'Klant' }],
          groepering: ['city'],
        },
        KOLOMMEN,
      ),
    ).toThrow(/geen functie/);
  });

  it('maakt van een telling altijd een geheel getal', () => {
    const gebouwd = bouwSql(
      {
        entiteit: 'organizations',
        kolommen: [
          { veld: 'city' },
          { veld: 'id', kop: 'Aantal', aggregatie: 'count' },
        ],
        groepering: ['city'],
      },
      KOLOMMEN,
    );

    expect(gebouwd.kolommen[1]!.type).toBe('getal');
  });
});

describe('draaien', () => {
  it('levert de rijen op', () => {
    const uitkomst = draaiBouwer(handle, pad, {
      entiteit: 'organizations',
      kolommen: [{ veld: 'name', kop: 'Klant' }, { veld: 'city', kop: 'Plaats' }],
      sortering: [{ veld: 'name' }],
    });

    // De gearchiveerde derde klant hoort er niet bij te staan.
    expect(uitkomst.uitkomst.rijen).toHaveLength(2);
    expect(uitkomst.uitkomst.rijen[0]!.Klant).toBe('Jansen');
    expect(uitkomst.kolommen.map((kolom) => kolom.kop)).toEqual(['Klant', 'Plaats']);
  });

  it('filtert met gebonden waarden', () => {
    const uitkomst = draaiBouwer(handle, pad, {
      entiteit: 'organizations',
      kolommen: [{ veld: 'name', kop: 'Klant' }],
      filter: { field: 'city', operator: 'eq', value: 'Tilburg' },
    });

    expect(uitkomst.uitkomst.rijen).toHaveLength(1);
    expect(uitkomst.uitkomst.rijen[0]!.Klant).toBe('Jansen');
  });

  it('groepeert en telt', () => {
    const uitkomst = draaiBouwer(handle, pad, {
      entiteit: 'organizations',
      kolommen: [
        { veld: 'city', kop: 'Plaats' },
        { veld: 'id', kop: 'Aantal', aggregatie: 'count' },
      ],
      groepering: ['city'],
      sortering: [{ veld: 'city' }],
    });

    expect(uitkomst.uitkomst.rijen).toEqual([
      { Plaats: 'Nieuwegein', Aantal: 1 },
      { Plaats: 'Tilburg', Aantal: 1 },
    ]);
  });

  it('kan de database niet wijzigen', () => {
    // De bouwer draait read-only; dat is te zien aan het feit dat een
    // gearchiveerd record na een rapportage nog steeds gearchiveerd is en er
    // niets bij of af is gegaan.
    draaiBouwer(handle, pad, {
      entiteit: 'organizations',
      kolommen: [{ veld: 'name' }],
      metGearchiveerde: true,
    });

    const aantal = handle.raw.prepare('SELECT COUNT(*) AS n FROM organizations').get() as {
      n: number;
    };
    expect(aantal.n).toBe(3);
  });
});

describe('kolommen ontdekken', () => {
  it('leest de kolommen uit de tabel zelf', () => {
    const namen = kolommenVan(handle, 'organizations').map((kolom) => kolom.sleutel);

    expect(namen).toContain('name');
    expect(namen).toContain('postcode');
  });

  it('noemt alle entiteiten met hun kolommen', () => {
    const alles = beschikbareEntiteiten(handle);

    expect(alles.length).toBeGreaterThan(5);
    expect(alles.find((entiteit) => entiteit.sleutel === 'organizations')?.kolommen.length)
      .toBeGreaterThan(10);
  });

  it('raadt het soort waarde aan de naam', () => {
    expect(raadType('amount_cents', 'INTEGER')).toBe('bedrag');
    expect(raadType('probability_bp', 'INTEGER')).toBe('procent');
    expect(raadType('created_at', 'TEXT')).toBe('datum');
    expect(raadType('start_date', 'TEXT')).toBe('datum');
    expect(raadType('unit_count', 'INTEGER')).toBe('getal');
    expect(raadType('name', 'TEXT')).toBe('tekst');
  });
});
