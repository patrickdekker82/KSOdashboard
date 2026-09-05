/**
 * Tests voor back-up en herstel (hoofdstuk 12).
 *
 * De vraag die telt is niet of er een bestand verschijnt, maar of je er iets
 * aan hebt op de ochtend dat het misgaat. Dus: is de kopie een volledige,
 * bruikbare database, wordt een kapotte back-up geweigerd vóórdat hij de goede
 * overschrijft, en kun je een verkeerd herstel terugdraaien.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import {
  BackupFout,
  bestandsnaamVoor,
  controleerBruikbaar,
  herstelBackup,
  laatsteStand,
  lijstBackups,
  logboek,
  maakBackup,
  ruimOp,
  tijdstempel,
} from './backup.ts';

let map: string;
let databasepad: string;
let backupmap: string;
let handle: DatabaseHandle;

const NU = new Date('2026-09-07T14:30:00Z');

beforeEach(() => {
  map = mkdtempSync(join(tmpdir(), 'showroom-backup-'));
  databasepad = join(map, 'showroom.db');
  backupmap = join(map, 'backups');
  handle = openDatabase(databasepad);
  runMigrations(handle);

  handle.raw
    .prepare("INSERT INTO users (name, initials, email, password_hash) VALUES ('Patrick', 'PD', 'p@x.local', 'x')")
    .run();
  handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Bouwbedrijf Kroon B.V.')").run();
});

afterEach(() => {
  try {
    handle.close();
  } catch {
    // Al gesloten door een hersteltest; dat is hier geen fout.
  }
  rmSync(map, { recursive: true, force: true });
});

function aantalKlanten(pad = databasepad): number {
  const lezer = openDatabase(pad, { readOnly: true });
  try {
    return (lezer.raw.prepare('SELECT COUNT(*) AS n FROM organizations').get() as { n: number }).n;
  } finally {
    lezer.close();
  }
}

describe('een back-up maken', () => {
  it('levert een bestand op dat zelf een werkende database is', () => {
    const uitkomst = maakBackup(handle, databasepad, backupmap, { nu: NU });

    expect(existsSync(uitkomst.pad)).toBe(true);
    expect(uitkomst.bytes).toBeGreaterThan(0);
    expect(aantalKlanten(uitkomst.pad)).toBe(1);
  });

  it('pakt ook wijzigingen mee die nog in het WAL-bestand staan', () => {
    // Dit is de reden dat er `VACUUM INTO` gebruikt wordt en geen `copyFile`:
    // onder WAL staat een verse wijziging nog niet in het hoofdbestand, en een
    // platte kopie levert dan een database op waar die rij niet in zit.
    handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Net toegevoegd')").run();

    const uitkomst = maakBackup(handle, databasepad, backupmap, { nu: NU });

    expect(aantalKlanten(uitkomst.pad)).toBe(2);
  });

  it('zet de loop in het logboek', () => {
    maakBackup(handle, databasepad, backupmap, { nu: NU, gebruikerId: 1 });
    const regels = logboek(handle);

    expect(regels).toHaveLength(1);
    expect(regels[0]!.status).toBe('ok');
    expect(regels[0]!.soort).toBe('handmatig');
    expect(regels[0]!.gebruiker).toBe('Patrick');
    expect(Number(regels[0]!.bytes)).toBeGreaterThan(0);
  });

  it('zet ook een mislukte poging in het logboek', () => {
    expect(() =>
      maakBackup(handle, join(map, 'bestaat-niet.db'), backupmap, { nu: NU }),
    ).toThrow(BackupFout);

    const regels = logboek(handle);
    expect(regels[0]!.status).toBe('fout');
    expect(String(regels[0]!.fout)).toContain('bestaat-niet.db');
  });

  it('maakt de doelmap aan als die er nog niet is', () => {
    const elders = join(map, 'netwerkschijf', 'showroom');
    const uitkomst = maakBackup(handle, databasepad, backupmap, { doelmap: elders, nu: NU });

    expect(uitkomst.pad.startsWith(elders)).toBe(true);
    expect(existsSync(uitkomst.pad)).toBe(true);
  });

  it('weigert een tweede back-up met dezelfde naam', () => {
    maakBackup(handle, databasepad, backupmap, { nu: NU });

    expect(() => maakBackup(handle, databasepad, backupmap, { nu: NU })).toThrow(/staat al/);
  });

  it('maakt een bestandsnaam die Windows accepteert en op tijd sorteert', () => {
    expect(tijdstempel(NU)).toBe('2026-09-07T14-30');
    expect(bestandsnaamVoor('automatisch', NU)).toBe('showroom-automatisch-2026-09-07T14-30.db');
    expect(bestandsnaamVoor('handmatig', NU)).not.toContain(':');
  });
});

describe('opruimen', () => {
  it('houdt de nieuwste en gooit de rest weg', () => {
    for (let dag = 1; dag <= 5; dag += 1) {
      maakBackup(handle, databasepad, backupmap, {
        soort: 'automatisch',
        nu: new Date(`2026-09-0${dag}T23:00:00Z`),
      });
    }

    const weg = ruimOp(backupmap, 'showroom-automatisch', 2);

    expect(weg).toBe(3);
    expect(lijstBackups(backupmap)).toHaveLength(2);
  });

  it('laat een andere soort met rust', () => {
    maakBackup(handle, databasepad, backupmap, { soort: 'automatisch', nu: NU });
    maakBackup(handle, databasepad, backupmap, { soort: 'handmatig', nu: NU });

    ruimOp(backupmap, 'showroom-automatisch', 0);

    // `bewaar` 0 betekent alles bewaren, niet alles weggooien: anders veegt een
    // instelling die per ongeluk leeg blijft de hele back-upmap leeg.
    expect(lijstBackups(backupmap)).toHaveLength(2);
  });

  it('ruimt op tijdens de loop zelf en meldt hoeveel', () => {
    maakBackup(handle, databasepad, backupmap, {
      soort: 'automatisch',
      nu: new Date('2026-09-01T23:00:00Z'),
    });
    const tweede = maakBackup(handle, databasepad, backupmap, {
      soort: 'automatisch',
      nu: new Date('2026-09-02T23:00:00Z'),
      bewaar: 1,
    });

    expect(tweede.opgeruimd).toBe(1);
    expect(lijstBackups(backupmap)).toHaveLength(1);
  });
});

describe('de lijst', () => {
  it('geeft de nieuwste eerst, met soort en grootte', () => {
    maakBackup(handle, databasepad, backupmap, {
      soort: 'automatisch',
      nu: new Date('2026-09-01T23:00:00Z'),
    });
    maakBackup(handle, databasepad, backupmap, { soort: 'handmatig', nu: NU });

    const lijst = lijstBackups(backupmap);

    expect(lijst).toHaveLength(2);
    expect(lijst[0]!.soort).toBe('handmatig');
    expect(lijst[1]!.soort).toBe('automatisch');
    expect(lijst[0]!.bytes).toBeGreaterThan(0);
  });

  it('is leeg als de map nog niet bestaat', () => {
    expect(lijstBackups(join(map, 'nergens'))).toEqual([]);
  });
});

describe('controleren voordat er iets teruggezet wordt', () => {
  it('laat een echte back-up door', () => {
    const uitkomst = maakBackup(handle, databasepad, backupmap, { nu: NU });

    expect(() => controleerBruikbaar(uitkomst.pad)).not.toThrow();
  });

  it('weigert een bestand dat geen database is', () => {
    const nep = join(map, 'nep.db');
    writeFileSync(nep, 'dit is gewoon tekst');

    expect(() => controleerBruikbaar(nep)).toThrow(BackupFout);
  });

  it('weigert een database die niet van deze applicatie is', () => {
    const vreemd = join(map, 'vreemd.db');
    const anders = openDatabase(vreemd);
    anders.raw.exec('CREATE TABLE iets (a TEXT)');
    anders.close();

    expect(() => controleerBruikbaar(vreemd)).toThrow(/niet die van Showroom Suite/);
  });
});

describe('herstellen', () => {
  it('zet de gegevens van de back-up terug', () => {
    const uitkomst = maakBackup(handle, databasepad, backupmap, { nu: NU });

    // Na de back-up gaat er nog iets bij; dat moet na het herstel weg zijn.
    handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Later toegevoegd')").run();
    expect(aantalKlanten()).toBe(2);
    handle.close();

    herstelBackup(databasepad, backupmap, uitkomst.bestandsnaam, NU);

    expect(aantalKlanten()).toBe(1);
    handle = openDatabase(databasepad);
  });

  it('maakt eerst een veiligheidskopie van wat er stond', () => {
    const uitkomst = maakBackup(handle, databasepad, backupmap, { nu: NU });
    handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Later toegevoegd')").run();
    handle.close();

    const hersteld = herstelBackup(databasepad, backupmap, uitkomst.bestandsnaam, NU);

    expect(hersteld.veiligheidskopie).toContain('voor-herstel');
    // En daar zitten de twee klanten nog in, dus het herstel is terug te draaien.
    expect(aantalKlanten(join(backupmap, hersteld.veiligheidskopie))).toBe(2);

    handle = openDatabase(databasepad);
  });

  it('laat de database met rust als de back-up beschadigd is', () => {
    const nep = join(backupmap, 'showroom-handmatig-2026-01-01T00-00.db');
    maakBackup(handle, databasepad, backupmap, { nu: NU });
    writeFileSync(nep, 'kapot');
    handle.close();

    expect(() => herstelBackup(databasepad, backupmap, 'showroom-handmatig-2026-01-01T00-00.db')).toThrow(
      BackupFout,
    );

    // De echte database staat er nog, met zijn gegevens.
    expect(aantalKlanten()).toBe(1);
    handle = openDatabase(databasepad);
  });

  it('weigert een pad met mappen erin', () => {
    expect(() => herstelBackup(databasepad, backupmap, '../../etc/passwd')).toThrow(
      /alleen de bestandsnaam/,
    );
  });

  it('weigert een back-up die er niet is', () => {
    expect(() => herstelBackup(databasepad, backupmap, 'verzonnen.db')).toThrow(/niet gevonden|staat niet/);
  });

  it('ruimt de WAL-bestanden van de oude database op', () => {
    const uitkomst = maakBackup(handle, databasepad, backupmap, { nu: NU });
    handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Zorgt voor WAL')").run();
    handle.close();

    herstelBackup(databasepad, backupmap, uitkomst.bestandsnaam, NU);

    // Een achtergebleven WAL hoort bij de oude database en zou de teruggezette
    // database weer vervuilen.
    expect(existsSync(`${databasepad}-wal`)).toBe(false);
    expect(existsSync(`${databasepad}-shm`)).toBe(false);

    handle = openDatabase(databasepad);
  });

  it('laat geen half bestand achter als het misgaat', () => {
    const voor = statSync(databasepad).size;

    expect(() => herstelBackup(databasepad, backupmap, 'verzonnen.db')).toThrow(BackupFout);

    expect(statSync(databasepad).size).toBe(voor);
    expect(existsSync(`${databasepad}.nieuw`)).toBe(false);
  });
});

describe('de stand voor de signalering', () => {
  it('meldt niets als er nooit gedraaid is', () => {
    const stand = laatsteStand(handle);

    expect(stand.laatsteGelukt).toBeNull();
    expect(stand.laatsteMislukt).toBe(false);
  });

  it('onthoudt wanneer het voor het laatst lukte', () => {
    maakBackup(handle, databasepad, backupmap, { nu: NU });

    expect(laatsteStand(handle).laatsteGelukt).not.toBeNull();
    expect(laatsteStand(handle).laatsteMislukt).toBe(false);
  });

  it('meldt het als de laatste poging mislukte, ook al lukte een eerdere', () => {
    maakBackup(handle, databasepad, backupmap, { nu: NU });
    expect(() => maakBackup(handle, join(map, 'weg.db'), backupmap)).toThrow();

    const stand = laatsteStand(handle);

    expect(stand.laatsteGelukt).not.toBeNull();
    expect(stand.laatsteMislukt).toBe(true);
    expect(stand.fout).toContain('weg.db');
  });
});

describe('de back-up staat los van de database', () => {
  it('bevat geen WAL-verwijzing meer, dus is los te kopiëren', () => {
    const uitkomst = maakBackup(handle, databasepad, backupmap, { nu: NU });

    // Een VACUUM INTO-bestand staat op zichzelf: er hoort geen -wal naast.
    expect(existsSync(`${uitkomst.pad}-wal`)).toBe(false);
    expect(readFileSync(uitkomst.pad).subarray(0, 15).toString('latin1')).toBe('SQLite format 3');
  });
});
