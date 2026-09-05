/**
 * Tests voor de updatecontrole (hoofdstuk 12).
 *
 * De versievergelijking is het stuk dat stil fout kan gaan: `0.10.0` is nieuwer
 * dan `0.9.0`, maar als tekst niet. Dat is precies het soort fout waarbij
 * iedereen maandenlang op een oude versie blijft zitten zonder dat iemand het
 * merkt.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  controleerUpdate,
  leesManifest,
  MANIFEST_BESTANDSNAAM,
  vergelijkVersies,
} from './updates.ts';

let map: string;

beforeEach(() => {
  map = mkdtempSync(join(tmpdir(), 'showroom-update-'));
});

afterEach(() => {
  rmSync(map, { recursive: true, force: true });
});

function zetManifest(inhoud: Record<string, unknown>): void {
  writeFileSync(join(map, MANIFEST_BESTANDSNAAM), JSON.stringify(inhoud), 'utf8');
}

describe('versies vergelijken', () => {
  it('telt per onderdeel en niet als tekst', () => {
    // Dit is de fout die je pas maanden later ontdekt.
    expect(vergelijkVersies('0.10.0', '0.9.0')).toBe(1);
    expect(vergelijkVersies('1.0.0', '0.99.99')).toBe(1);
    expect(vergelijkVersies('2.1.3', '2.1.10')).toBe(-1);
  });

  it('ziet gelijke versies als gelijk', () => {
    expect(vergelijkVersies('1.2.3', '1.2.3')).toBe(0);
    expect(vergelijkVersies('1.2', '1.2.0')).toBe(0);
  });

  it('negeert een voorloop-v en een achtervoegsel', () => {
    expect(vergelijkVersies('v1.2.3', '1.2.3')).toBe(0);
    expect(vergelijkVersies('1.2.3-rc1', '1.2.3')).toBe(0);
  });

  it('valt terug op nul bij onzin in plaats van NaN', () => {
    expect(vergelijkVersies('1.x.3', '1.0.3')).toBe(0);
  });
});

describe('het manifest lezen', () => {
  it('leest de velden die erin staan', () => {
    const manifest = leesManifest(
      JSON.stringify({
        versie: '0.2.0',
        bestand: 'ShowroomSuite-Setup-0.2.0.exe',
        uitgebracht: '2026-09-07',
        opmerkingen: 'Rapportages toegevoegd',
      }),
    );

    expect(manifest.versie).toBe('0.2.0');
    expect(manifest.bestand).toBe('ShowroomSuite-Setup-0.2.0.exe');
    expect(manifest.opmerkingen).toBe('Rapportages toegevoegd');
  });

  it('weigert onleesbare JSON met een Nederlandse uitleg', () => {
    expect(() => leesManifest('{ dit is geen json')).toThrow(/geldige JSON/);
  });

  it('weigert een manifest zonder bruikbaar versienummer', () => {
    expect(() => leesManifest(JSON.stringify({ versie: 'de nieuwste' }))).toThrow(/versienummer/);
    expect(() => leesManifest(JSON.stringify({}))).toThrow(/versienummer/);
  });
});

describe('controleren', () => {
  it('staat uit zolang er geen locatie is ingesteld', () => {
    const uitkomst = controleerUpdate('', '0.1.0');

    expect(uitkomst.ingeschakeld).toBe(false);
    expect(uitkomst.nieuwerBeschikbaar).toBe(false);
    expect(uitkomst.fout).toBeNull();
  });

  it('meldt een nieuwere versie met de installer erbij', () => {
    zetManifest({ versie: '0.2.0', bestand: 'setup.exe', uitgebracht: '2026-09-07' });
    writeFileSync(join(map, 'setup.exe'), 'net alsof');

    const uitkomst = controleerUpdate(map, '0.1.0');

    expect(uitkomst.nieuwerBeschikbaar).toBe(true);
    expect(uitkomst.nieuwsteVersie).toBe('0.2.0');
    expect(uitkomst.installer).toBe(join(map, 'setup.exe'));
    expect(uitkomst.fout).toBeNull();
  });

  it('meldt niets als de eigen versie al de nieuwste is', () => {
    zetManifest({ versie: '0.1.0' });

    const uitkomst = controleerUpdate(map, '0.1.0');

    expect(uitkomst.nieuwerBeschikbaar).toBe(false);
    expect(uitkomst.nieuwsteVersie).toBe('0.1.0');
  });

  it('meldt niets als de eigen versie nieuwer is dan de netwerkschijf', () => {
    // Komt voor als iemand een testversie draait; dat is geen fout.
    zetManifest({ versie: '0.1.0' });

    expect(controleerUpdate(map, '0.2.0').nieuwerBeschikbaar).toBe(false);
  });

  it('zegt het als het versiebestand er niet staat', () => {
    const uitkomst = controleerUpdate(map, '0.1.0');

    expect(uitkomst.fout).toContain(MANIFEST_BESTANDSNAAM);
    expect(uitkomst.nieuwerBeschikbaar).toBe(false);
  });

  it('zegt het als de installer ontbreekt bij een aangekondigde versie', () => {
    zetManifest({ versie: '0.2.0', bestand: 'setup.exe' });

    const uitkomst = controleerUpdate(map, '0.1.0');

    expect(uitkomst.nieuwerBeschikbaar).toBe(true);
    expect(uitkomst.installer).toBeNull();
    expect(uitkomst.fout).toContain('staat er niet naast');
  });

  it('weigert een pad dat niet volledig is', () => {
    expect(controleerUpdate('updates', '0.1.0').fout).toContain('volledig pad');
  });

  it('valt niet om over een kapot versiebestand', () => {
    writeFileSync(join(map, MANIFEST_BESTANDSNAAM), 'kapot', 'utf8');

    const uitkomst = controleerUpdate(map, '0.1.0');

    expect(uitkomst.fout).toContain('geldige JSON');
    expect(uitkomst.nieuwerBeschikbaar).toBe(false);
  });
});
