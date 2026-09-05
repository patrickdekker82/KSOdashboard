/**
 * Tests voor de sleutelkluis.
 *
 * Drie dingen moeten kloppen: een geheim komt er ongeschonden weer uit, de
 * database alléén levert niets op zonder het sleutelbestand, en een
 * gemanipuleerde cijfertekst wordt geweigerd in plaats van stil verkeerd
 * ontsleuteld.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import {
  bewaarGeheim,
  gelijk,
  heeftGeheim,
  KluisFout,
  laadSleutel,
  leesGeheim,
  maskeer,
  ontsleutel,
  SLEUTELBESTAND,
  versleutel,
  verwijderGeheim,
} from './kluis.ts';

let map: string;
let handle: DatabaseHandle;

const SLEUTEL = 'sk-ant-api03-VoorbeeldSleutelDieNietBestaat-1234';

beforeEach(() => {
  map = mkdtempSync(join(tmpdir(), 'showroom-kluis-'));
  handle = openDatabase(join(map, 'showroom.db'));
  runMigrations(handle);
});

afterEach(() => {
  handle.close();
  rmSync(map, { recursive: true, force: true });
});

describe('sleutelbestand', () => {
  it('maakt er één aan en gebruikt daarna steeds dezelfde', () => {
    const eerste = laadSleutel(map);
    const tweede = laadSleutel(map);

    expect(eerste).toHaveLength(32);
    expect(tweede.equals(eerste)).toBe(true);
  });

  it('weigert een beschadigd sleutelbestand met een leesbare uitleg', () => {
    writeFileSync(join(map, SLEUTELBESTAND), 'te kort');

    expect(() => laadSleutel(map)).toThrow(KluisFout);
    expect(() => laadSleutel(map)).toThrow(/beschadigd/);
  });
});

describe('versleutelen', () => {
  it('gaat heen en weer', () => {
    const sleutel = laadSleutel(map);
    const doos = versleutel(sleutel, SLEUTEL);

    expect(doos.ciphertext).not.toContain('sk-ant');
    expect(ontsleutel(sleutel, doos)).toBe(SLEUTEL);
  });

  it('levert bij dezelfde tekst tóch twee verschillende cijferteksten op', () => {
    // Anders verraadt de database dat twee werkplekken dezelfde sleutel delen.
    const sleutel = laadSleutel(map);

    expect(versleutel(sleutel, SLEUTEL).ciphertext).not.toBe(
      versleutel(sleutel, SLEUTEL).ciphertext,
    );
  });

  it('weigert een gemanipuleerde cijfertekst', () => {
    const sleutel = laadSleutel(map);
    const doos = versleutel(sleutel, SLEUTEL);
    const bytes = Buffer.from(doos.ciphertext, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;

    expect(() =>
      ontsleutel(sleutel, { ...doos, ciphertext: bytes.toString('base64') }),
    ).toThrow(KluisFout);
  });

  it('weigert een andere sleutel — een back-up zonder sleutelbestand is waardeloos', () => {
    const doos = versleutel(laadSleutel(map), SLEUTEL);
    const andereMap = mkdtempSync(join(tmpdir(), 'showroom-kluis-2-'));

    try {
      expect(() => ontsleutel(laadSleutel(andereMap), doos)).toThrow(/opnieuw in/);
    } finally {
      rmSync(andereMap, { recursive: true, force: true });
    }
  });
});

describe('opslag', () => {
  it('bewaart, leest, meldt en verwijdert', () => {
    expect(heeftGeheim(handle, 'anthropic_api_key')).toBe(false);

    bewaarGeheim(handle, map, 'anthropic_api_key', SLEUTEL);

    expect(heeftGeheim(handle, 'anthropic_api_key')).toBe(true);
    expect(leesGeheim(handle, map, 'anthropic_api_key')).toBe(SLEUTEL);

    verwijderGeheim(handle, 'anthropic_api_key');

    expect(leesGeheim(handle, map, 'anthropic_api_key')).toBeNull();
  });

  it('overschrijft een bestaand geheim in plaats van te struikelen', () => {
    bewaarGeheim(handle, map, 'anthropic_api_key', SLEUTEL);
    bewaarGeheim(handle, map, 'anthropic_api_key', 'sk-ant-nieuw');

    expect(leesGeheim(handle, map, 'anthropic_api_key')).toBe('sk-ant-nieuw');
  });

  it('wist het geheim als er een lege waarde binnenkomt', () => {
    bewaarGeheim(handle, map, 'anthropic_api_key', SLEUTEL);
    bewaarGeheim(handle, map, 'anthropic_api_key', '');

    expect(heeftGeheim(handle, 'anthropic_api_key')).toBe(false);
  });

  it('zet de sleutel nergens leesbaar in de database', () => {
    bewaarGeheim(handle, map, 'anthropic_api_key', SLEUTEL);
    handle.close();

    const bestand = readFileSync(join(map, 'showroom.db')).toString('latin1');
    expect(bestand).not.toContain(SLEUTEL);

    handle = openDatabase(join(map, 'showroom.db'));
  });
});

describe('hulpjes', () => {
  it('maskeert op de laatste vier tekens', () => {
    expect(maskeer(SLEUTEL)).toBe('••••••••1234');
    expect(maskeer('')).toBe('');
  });

  it('vergelijkt ook ongelijke lengtes zonder te struikelen', () => {
    expect(gelijk('abc', 'abc')).toBe(true);
    expect(gelijk('abc', 'abcd')).toBe(false);
    expect(gelijk('abc', 'abd')).toBe(false);
  });
});
