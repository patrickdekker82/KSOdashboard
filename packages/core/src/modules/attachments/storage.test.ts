import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  absoluutBinnenMap,
  BijlageFout,
  controleerBijlage,
  extensieVan,
  genereerOpslagPad,
  MAX_BIJLAGE_BYTES,
  mimetypeVoor,
  TOEGESTANE_EXTENSIES,
  veiligeToonNaam,
} from './storage.ts';

const MAP = '/data/ShowroomSuite/attachments';

describe('extensies', () => {
  it('leest de extensie in kleine letters', () => {
    expect(extensieVan('Offerte.PDF')).toBe('pdf');
    expect(extensieVan('archief.tar.gz')).toBe('gz');
  });

  it('geeft niets terug bij een naam zonder extensie', () => {
    expect(extensieVan('README')).toBe('');
    expect(extensieVan('.gitignore')).toBe(''); // begint met een punt, geen extensie
    expect(extensieVan('eindigt.')).toBe('');
  });
});

describe('welke bestanden erin mogen', () => {
  it('accepteert de gewone kantoorbestanden', () => {
    for (const naam of ['offerte.pdf', 'plan.docx', 'begroting.xlsx', 'foto.jpg', 'bestek.zip']) {
      expect(() => controleerBijlage(naam, 1024), naam).not.toThrow();
    }
  });

  it('weigert uitvoerbare bestanden', () => {
    for (const naam of ['virus.exe', 'script.bat', 'macro.vbs', 'shell.ps1', 'ding.dll', 'app.msi']) {
      expect(() => controleerBijlage(naam, 1024), naam).toThrow(BijlageFout);
    }
  });

  it('weigert SVG, ook al is het een afbeelding', () => {
    // Een SVG kan scripts bevatten en wordt door de browser uitgevoerd.
    expect(() => controleerBijlage('logo.svg', 1024)).toThrow(/niet geaccepteerd/);
    expect(Object.hasOwn(TOEGESTANE_EXTENSIES, 'svg')).toBe(false);
  });

  it('laat zich niet foppen door hoofdletters of een dubbele extensie', () => {
    expect(() => controleerBijlage('virus.PDF.exe', 1024)).toThrow(BijlageFout);
    expect(() => controleerBijlage('offerte.PDF', 1024)).not.toThrow();
  });

  it('weigert een bestand zonder extensie met uitleg', () => {
    expect(() => controleerBijlage('naamloos', 1024)).toThrow(/geen extensie/);
  });

  it('weigert een leeg bestand', () => {
    expect(() => controleerBijlage('leeg.pdf', 0)).toThrow(/leeg/);
  });

  it('houdt de grens van 25 MB aan en noemt de werkelijke grootte', () => {
    expect(() => controleerBijlage('groot.pdf', MAX_BIJLAGE_BYTES)).not.toThrow();
    expect(() => controleerBijlage('groot.pdf', MAX_BIJLAGE_BYTES + 1)).toThrow(/25 MB/);
    try {
      controleerBijlage('groot.pdf', 30 * 1024 * 1024);
    } catch (error) {
      expect((error as Error).message).toContain('30.0 MB');
    }
  });
});

describe('de getoonde naam', () => {
  it('houdt alleen de bestandsnaam over', () => {
    expect(veiligeToonNaam('C:\\Users\\patrick\\offerte.pdf')).toBe('offerte.pdf');
    expect(veiligeToonNaam('../../../etc/passwd')).toBe('passwd');
  });

  it('haalt aanhalingstekens en stuurtekens weg', () => {
    // Die zouden een Content-Disposition-kop kunnen breken.
    expect(veiligeToonNaam('of"erte.pdf')).toBe('oferte.pdf');
    expect(veiligeToonNaam('naam\r\nX-Injectie: 1.pdf')).toBe('naam X-Injectie: 1.pdf');
  });

  it('kort een absurd lange naam in', () => {
    expect(veiligeToonNaam(`${'a'.repeat(500)}.pdf`).length).toBeLessThanOrEqual(180);
  });

  it('valt terug op "bijlage" bij een onbruikbare naam', () => {
    expect(veiligeToonNaam('')).toBe('bijlage');
    expect(veiligeToonNaam('..')).toBe('bijlage');
    expect(veiligeToonNaam('/')).toBe('bijlage');
  });
});

describe('de naam op schijf', () => {
  it('neemt niets van de invoer over behalve de extensie', () => {
    const pad = genereerOpslagPad('pdf', new Date('2026-03-15T00:00:00Z'));
    expect(pad).toMatch(/^2026\/03\/[0-9a-f]{32}\.pdf$/);
  });

  it('geeft elke keer een andere naam', () => {
    const een = genereerOpslagPad('pdf');
    const twee = genereerOpslagPad('pdf');
    expect(een).not.toBe(twee);
  });
});

describe('het pad blijft binnen de bijlagenmap', () => {
  it('accepteert een normaal gegenereerd pad', () => {
    expect(absoluutBinnenMap(MAP, '2026/03/abc.pdf')).toBe(join(MAP, '2026/03/abc.pdf'));
  });

  it('weigert elke poging om eruit te klimmen', () => {
    for (const pad of [
      '../config.json',
      '../../showroom.db',
      '2026/../../../etc/passwd',
      './../../geheim.txt',
      '2026/03/../../../buiten.pdf',
    ]) {
      expect(() => absoluutBinnenMap(MAP, pad), pad).toThrow(BijlageFout);
    }
  });

  it('weigert een absoluut pad', () => {
    expect(() => absoluutBinnenMap(MAP, '/etc/passwd')).toThrow(/niet geldig/);
  });

  it('weigert een leeg pad en een pad met een NUL-byte', () => {
    expect(() => absoluutBinnenMap(MAP, '')).toThrow(BijlageFout);
    expect(() => absoluutBinnenMap(MAP, '2026/03/a\u0000.pdf')).toThrow(BijlageFout);
  });

  it('weigert het pad dat gelijk is aan de map zelf', () => {
    expect(() => absoluutBinnenMap(MAP, '.')).toThrow(BijlageFout);
  });
});

describe('mimetypes', () => {
  it('geeft het type dat bij de extensie hoort', () => {
    expect(mimetypeVoor('pdf')).toBe('application/pdf');
    expect(mimetypeVoor('png')).toBe('image/png');
  });

  it('valt terug op een neutraal type bij iets onbekends', () => {
    expect(mimetypeVoor('onbekend')).toBe('application/octet-stream');
  });
});
