/**
 * Tests voor de beveiligde SQL-modus (hoofdstuk 6.9).
 *
 * Dit is het gevaarlijkste knopje van de applicatie, dus hier wordt niet
 * getoetst of het werkt maar of het dichtzit. Elke schrijfactie die iemand zou
 * kunnen proberen krijgt een eigen test, en de belangrijkste toets is dat de
 * gegevens ná de poging nog steeds ongewijzigd zijn.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import {
  beschrijfSchema,
  keurSql,
  MAX_RIJEN,
  ontdoeVanTekst,
  SqlFout,
  voerSqlUit,
} from './sql.ts';

let map: string;
let pad: string;
let handle: DatabaseHandle;

beforeEach(() => {
  map = mkdtempSync(join(tmpdir(), 'showroom-sql-'));
  pad = join(map, 'showroom.db');
  handle = openDatabase(pad);
  runMigrations(handle);

  handle.raw
    .prepare(
      "INSERT INTO organizations (name, city) VALUES ('Bouwbedrijf Kroon B.V.', 'Nieuwegein')",
    )
    .run();
  handle.raw.prepare("INSERT INTO organizations (name, city) VALUES ('Jansen & Zn', 'Tilburg')").run();
});

afterEach(() => {
  handle.close();
  rmSync(map, { recursive: true, force: true });
});

/** Hoeveel klanten er nu staan. Om te bewijzen dat er niets is veranderd. */
function aantalKlanten(): number {
  const rij = handle.raw.prepare('SELECT COUNT(*) AS n FROM organizations').get() as { n: number };
  return rij.n;
}

describe('de tekstcontrole', () => {
  it('laat een gewone SELECT door', () => {
    expect(keurSql('SELECT 1')).toBe('SELECT 1');
    expect(keurSql('  SELECT 1;  ')).toBe('SELECT 1');
  });

  it('laat WITH door, want een CTE is een normale manier om te vragen', () => {
    expect(() => keurSql('WITH t AS (SELECT 1 AS a) SELECT * FROM t')).not.toThrow();
  });

  it('weigert een lege query', () => {
    expect(() => keurSql('   ')).toThrow(/geen query/);
  });

  it('weigert alles wat niet met SELECT of WITH begint', () => {
    for (const query of [
      'INSERT INTO organizations (name) VALUES ("x")',
      'UPDATE organizations SET name = "x"',
      'DELETE FROM organizations',
      'DROP TABLE organizations',
      'ALTER TABLE organizations ADD COLUMN x TEXT',
      'CREATE TABLE t (a TEXT)',
      'VACUUM',
    ]) {
      expect(() => keurSql(query), query).toThrow(SqlFout);
    }
  });

  it('weigert een tweede instructie achter een puntkomma', () => {
    expect(() => keurSql('SELECT 1; DELETE FROM organizations')).toThrow(/één query tegelijk/);
  });

  it('weigert ATTACH en PRAGMA, ook al is de verbinding read-only', () => {
    // Deze twee kunnen op een leesverbinding nog steeds iets doen wat we niet
    // willen: een tweede bestand aankoppelen of instellingen omzetten.
    expect(() => keurSql("SELECT 1 FROM x; ATTACH DATABASE 'a.db' AS a")).toThrow(SqlFout);
    expect(() => keurSql('SELECT * FROM pragma_table_info("users")')).toThrow(/PRAGMA/);
  });

  it('weigert load_extension', () => {
    expect(() => keurSql("SELECT load_extension('kwaad.so')")).toThrow(/LOAD_EXTENSION/);
  });

  it('laat een verboden woord binnen een tekstwaarde wél door', () => {
    // Anders wordt een notitie met het woord "update" erin geweigerd, en dat
    // begrijpt niemand.
    expect(() => keurSql("SELECT 'update de klant' AS notitie")).not.toThrow();
    expect(() => keurSql("SELECT name FROM organizations WHERE name = 'Delete BV'")).not.toThrow();
  });

  it('laat een verboden woord in commentaar door', () => {
    expect(() => keurSql('SELECT 1 -- delete dit later')).not.toThrow();
    expect(() => keurSql('SELECT 1 /* drop deze query */')).not.toThrow();
  });

  it('trapt niet in commentaar dat een instructie verbergt', () => {
    expect(() => keurSql('SELECT 1 /* verstopt */ ; DELETE FROM organizations')).toThrow(
      /één query tegelijk/,
    );
  });

  it('haalt tekst, commentaar en aanhalingen weg voor de controle', () => {
    const plat = (sql: string): string => ontdoeVanTekst(sql).replace(/\s+/g, ' ').trim();

    expect(plat("SELECT 'delete' -- drop")).toBe("SELECT ''");
    expect(plat('SELECT "kolom met delete erin"')).toBe('SELECT ""');
  });
});

describe('uitvoeren', () => {
  it('geeft rijen en kolomnamen terug', () => {
    const uitkomst = voerSqlUit(pad, 'SELECT name, city FROM organizations ORDER BY name');

    expect(uitkomst.kolommen).toEqual(['name', 'city']);
    expect(uitkomst.rijen).toHaveLength(2);
    expect(uitkomst.rijen[0]!.name).toBe('Bouwbedrijf Kroon B.V.');
    expect(uitkomst.afgekapt).toBe(false);
  });

  it('geeft een lege uitkomst terug zonder te struikelen', () => {
    const uitkomst = voerSqlUit(pad, "SELECT name FROM organizations WHERE name = 'bestaat niet'");

    expect(uitkomst.rijen).toEqual([]);
    expect(uitkomst.kolommen).toEqual([]);
  });

  it('kapt af op de rijlimiet en zegt dat ook', () => {
    const uitkomst = voerSqlUit(
      pad,
      'WITH RECURSIVE tellen(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM tellen WHERE n < 50) SELECT n FROM tellen',
      10,
    );

    expect(uitkomst.rijen).toHaveLength(10);
    expect(uitkomst.afgekapt).toBe(true);
  });

  it('laat de rijlimiet nooit boven het plafond uitkomen', () => {
    const uitkomst = voerSqlUit(pad, 'SELECT 1 AS a', 999_999);

    expect(uitkomst.afgekapt).toBe(false);
    expect(MAX_RIJEN).toBeLessThan(999_999);
  });

  it('meet hoe lang het duurde', () => {
    expect(voerSqlUit(pad, 'SELECT 1').duurMs).toBeGreaterThanOrEqual(0);
  });

  it('vertaalt een SQL-fout naar iets leesbaars', () => {
    expect(() => voerSqlUit(pad, 'SELECT * FROM bestaat_niet')).toThrow(/kon niet worden uitgevoerd/);
  });
});

describe('de database blijft ongemoeid', () => {
  it('verandert niets bij een geweigerde DELETE', () => {
    expect(() => voerSqlUit(pad, 'DELETE FROM organizations')).toThrow(SqlFout);

    expect(aantalKlanten()).toBe(2);
  });

  it('verandert niets bij een geweigerde UPDATE', () => {
    expect(() => voerSqlUit(pad, "UPDATE organizations SET name = 'gehackt'")).toThrow(SqlFout);

    expect(
      (handle.raw.prepare('SELECT name FROM organizations ORDER BY id').get() as { name: string })
        .name,
    ).toBe('Bouwbedrijf Kroon B.V.');
  });

  it('verandert niets bij een DROP', () => {
    expect(() => voerSqlUit(pad, 'DROP TABLE organizations')).toThrow(SqlFout);

    expect(aantalKlanten()).toBe(2);
  });

  it('is ook dicht als de tekstcontrole eromheen zou worden gepraat', () => {
    // De read-only verbinding is de laag die telt. Om te bewijzen dat die er
    // echt is, gaan we hier bewust langs `keurSql` heen en schrijven we
    // rechtstreeks op een leesverbinding.
    const lezer = openDatabase(pad, { readOnly: true });

    try {
      expect(() => lezer.raw.prepare('DELETE FROM organizations').run()).toThrow();
      expect(aantalKlanten()).toBe(2);
    } finally {
      lezer.close();
    }
  });

  it('laat de gewone verbinding gewoon werken na een geweigerde poging', () => {
    expect(() => voerSqlUit(pad, 'DELETE FROM organizations')).toThrow(SqlFout);

    handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Derde')").run();

    expect(aantalKlanten()).toBe(3);
  });
});

describe('het schema tonen', () => {
  it('noemt de tabellen met hun kolommen', () => {
    const schema = beschrijfSchema(handle);
    const klanten = schema.find((tabel) => tabel.tabel === 'organizations');

    expect(klanten).toBeDefined();
    expect(klanten!.kolommen.map((kolom) => kolom.naam)).toContain('name');
  });

  it('laat de interne tabellen van SQLite en de zoekindex weg', () => {
    const namen = beschrijfSchema(handle).map((tabel) => tabel.tabel);

    expect(namen.some((naam) => naam.startsWith('sqlite_'))).toBe(false);
    expect(namen.some((naam) => naam.includes('_fts'))).toBe(false);
  });
});
