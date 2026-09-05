/**
 * Tests voor de nummerreeksen.
 *
 * Een nummer moet uniek zijn, oplopen en geen gaten hebben. Het randgeval dat
 * telt is de jaarovergang: zonder het jaar in het nummer springt de teller in
 * januari terug naar 0001 en bestaat dat nummer al.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import { bekijkVolgendNummer, NummerFout, volgendNummer } from './sequences.ts';

let directory: string;
let handle: DatabaseHandle;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-nummers-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

function reeks(sleutel: string, prefix: string, reset: string, padding = 4): void {
  handle.raw
    .prepare(
      'INSERT INTO number_sequences (key, prefix, next_value, padding, reset_period) VALUES (?, ?, 1, ?, ?)',
    )
    .run(sleutel, prefix, padding, reset);
}

describe('nummers uitgeven', () => {
  it('geeft het eerste nummer met voorvoegsel, jaar en opvulling', () => {
    reeks('package_quotes', 'OF', 'jaar');
    expect(volgendNummer(handle, 'package_quotes', new Date('2026-03-02T00:00:00Z'))).toBe(
      'OF-2026-0001',
    );
  });

  it('telt op bij elke aanvraag', () => {
    reeks('package_quotes', 'OF', 'jaar');
    const nu = new Date('2026-03-02T00:00:00Z');

    expect(volgendNummer(handle, 'package_quotes', nu)).toBe('OF-2026-0001');
    expect(volgendNummer(handle, 'package_quotes', nu)).toBe('OF-2026-0002');
    expect(volgendNummer(handle, 'package_quotes', nu)).toBe('OF-2026-0003');
  });

  // Twee aanvragen vlak na elkaar mogen nooit hetzelfde nummer krijgen; in de
  // hostmodus bedienen meerdere werkplekken dezelfde database.
  it('geeft honderd nummers uit zonder dubbele of gaten', () => {
    reeks('package_quotes', 'OF', 'jaar');
    const nu = new Date('2026-03-02T00:00:00Z');

    const nummers = Array.from({ length: 100 }, () => volgendNummer(handle, 'package_quotes', nu));

    expect(new Set(nummers).size).toBe(100);
    expect(nummers[0]).toBe('OF-2026-0001');
    expect(nummers[99]).toBe('OF-2026-0100');
  });

  it('begint in het nieuwe jaar opnieuw, met het jaar in het nummer', () => {
    reeks('package_quotes', 'OF', 'jaar');

    expect(volgendNummer(handle, 'package_quotes', new Date('2026-12-31T00:00:00Z'))).toBe(
      'OF-2026-0001',
    );
    expect(volgendNummer(handle, 'package_quotes', new Date('2027-01-01T00:00:00Z'))).toBe(
      'OF-2027-0001',
    );
    expect(volgendNummer(handle, 'package_quotes', new Date('2027-01-02T00:00:00Z'))).toBe(
      'OF-2027-0002',
    );
  });

  it('zet een maandreeks elke maand terug', () => {
    reeks('brieven', 'BR', 'maand');

    expect(volgendNummer(handle, 'brieven', new Date('2026-03-31T00:00:00Z'))).toBe('BR-2026-03-0001');
    expect(volgendNummer(handle, 'brieven', new Date('2026-04-01T00:00:00Z'))).toBe('BR-2026-04-0001');
  });

  it('laat een reeks zonder reset gewoon doortellen', () => {
    reeks('nooit', 'X', 'nooit');

    expect(volgendNummer(handle, 'nooit', new Date('2026-12-31T00:00:00Z'))).toBe('X-0001');
    expect(volgendNummer(handle, 'nooit', new Date('2027-01-01T00:00:00Z'))).toBe('X-0002');
  });

  it('houdt zich aan de ingestelde opvulling', () => {
    reeks('kort', 'K', 'nooit', 2);
    expect(volgendNummer(handle, 'kort', new Date('2026-03-02T00:00:00Z'))).toBe('K-01');
  });

  it('laat een nummer boven de opvulling gewoon groeien', () => {
    reeks('kort', 'K', 'nooit', 2);
    handle.raw.prepare('UPDATE number_sequences SET next_value = 100 WHERE key = ?').run('kort');
    expect(volgendNummer(handle, 'kort', new Date('2026-03-02T00:00:00Z'))).toBe('K-100');
  });

  it('werkt zonder voorvoegsel', () => {
    reeks('kaal', '', 'nooit');
    expect(volgendNummer(handle, 'kaal', new Date('2026-03-02T00:00:00Z'))).toBe('0001');
  });

  it('zegt het als een reeks niet bestaat', () => {
    expect(() => volgendNummer(handle, 'bestaatniet')).toThrow(NummerFout);
    expect(() => volgendNummer(handle, 'bestaatniet')).toThrow(/nummerreeks/);
  });
});

describe('vooruitkijken', () => {
  it('toont het volgende nummer zonder de teller op te hogen', () => {
    reeks('package_quotes', 'OF', 'jaar');
    const nu = new Date('2026-03-02T00:00:00Z');

    expect(bekijkVolgendNummer(handle, 'package_quotes', nu)).toBe('OF-2026-0001');
    expect(bekijkVolgendNummer(handle, 'package_quotes', nu)).toBe('OF-2026-0001');
    expect(volgendNummer(handle, 'package_quotes', nu)).toBe('OF-2026-0001');
  });

  it('geeft null voor een reeks die niet bestaat', () => {
    expect(bekijkVolgendNummer(handle, 'bestaatniet')).toBeNull();
  });
});
