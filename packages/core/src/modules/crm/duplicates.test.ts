import { describe, expect, it } from 'vitest';
import {
  levenshtein,
  naamGelijkenis,
  normaliseerKvk,
  normaliseerNaam,
  normaliseerPostcode,
  vindDubbelen,
  type Kandidaat,
} from './duplicates.ts';

function kandidaat(id: number, naam: string, extra: Partial<Kandidaat> = {}): Kandidaat {
  return { id, naam, kvk: null, postcode: null, huisnummer: null, ...extra };
}

describe('namen vergelijkbaar maken', () => {
  it('haalt rechtsvormen en leestekens weg', () => {
    expect(normaliseerNaam('Bouwbedrijf Meesters B.V.')).toBe('bouwbedrijf meesters');
    expect(normaliseerNaam('Meesters Bouwbedrijf bv')).toBe('bouwbedrijf meesters');
  });

  it('trekt zich niets aan van de woordvolgorde', () => {
    // "Van Dijk Bouw" en "Bouw Van Dijk" zijn in de praktijk dezelfde partij.
    expect(normaliseerNaam('Van Dijk Bouw')).toBe(normaliseerNaam('Bouw van Dijk'));
  });

  it('negeert accenten', () => {
    expect(normaliseerNaam('Café Zuid')).toBe(normaliseerNaam('Cafe Zuid'));
  });

  it('normaliseert postcodes en KvK-nummers', () => {
    expect(normaliseerPostcode('5011 aa')).toBe('5011AA');
    expect(normaliseerPostcode(null)).toBe('');
    expect(normaliseerKvk('1234 5678')).toBe('12345678');
    expect(normaliseerKvk('12345678')).toBe(normaliseerKvk('012345678'.slice(1)));
    expect(normaliseerKvk(null)).toBe('');
  });
});

describe('levenshtein', () => {
  it('telt bewerkingen', () => {
    expect(levenshtein('kat', 'kat')).toBe(0);
    expect(levenshtein('kat', 'kar')).toBe(1);
    expect(levenshtein('kat', 'karren')).toBe(4);
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('stopt zodra de grens overschreden wordt', () => {
    // Verder rekenen heeft geen zin: dit zijn geen dubbelen meer.
    expect(levenshtein('abcdefghij', 'zyxwvutsrq', 3)).toBeGreaterThan(3);
  });
});

describe('naamgelijkenis', () => {
  it('geeft 1 voor dezelfde naam na normaliseren', () => {
    expect(naamGelijkenis('Bouwbedrijf Meesters B.V.', 'meesters bouwbedrijf bv')).toBe(1);
  });

  it('herkent een tikfout', () => {
    expect(naamGelijkenis('Bouwbedrijf Meesters', 'Bouwbedrijf Meesteers')).toBeGreaterThan(0.9);
  });

  it('geeft een lage score aan verschillende bedrijven', () => {
    expect(naamGelijkenis('Bouwbedrijf Meesters', 'CECI Ontwikkeling')).toBeLessThan(0.5);
  });

  it('geeft 0 als een naam leeg is', () => {
    expect(naamGelijkenis('', 'Meesters')).toBe(0);
  });
});

describe('dubbelen vinden', () => {
  it('is zeker bij hetzelfde KvK-nummer, ook bij een andere naam', () => {
    const paren = vindDubbelen([
      kandidaat(1, 'Bouwbedrijf Meesters', { kvk: '12345678' }),
      kandidaat(2, 'Meesters Vastgoed', { kvk: '1234 5678' }),
    ]);
    expect(paren).toHaveLength(1);
    expect(paren[0]!.score).toBe(100);
    expect(paren[0]!.redenen).toContain('kvk');
    expect(paren[0]!.uitleg).toContain('KvK');
  });

  it('herkent hetzelfde adres', () => {
    const paren = vindDubbelen([
      kandidaat(1, 'Alpha', { postcode: '5011 AA', huisnummer: '12' }),
      kandidaat(2, 'Beta', { postcode: '5011aa', huisnummer: '12' }),
    ]);
    expect(paren[0]!.score).toBe(90);
    expect(paren[0]!.redenen).toEqual(['adres']);
  });

  it('meldt een adres niet als het huisnummer verschilt', () => {
    const paren = vindDubbelen([
      kandidaat(1, 'Alpha', { postcode: '5011 AA', huisnummer: '12' }),
      kandidaat(2, 'Beta', { postcode: '5011 AA', huisnummer: '14' }),
    ]);
    expect(paren).toHaveLength(0);
  });

  it('meldt een sterk gelijkende naam als vermoeden, niet als zekerheid', () => {
    const paren = vindDubbelen([
      kandidaat(1, 'Bouwbedrijf Meesters B.V.'),
      kandidaat(2, 'Meesters Bouwbedrijf'),
    ]);
    expect(paren).toHaveLength(1);
    expect(paren[0]!.redenen).toEqual(['naam']);
    expect(paren[0]!.score).toBeLessThan(100);
    expect(paren[0]!.score).toBeGreaterThan(50);
  });

  it('combineert redenen en houdt de sterkste score aan', () => {
    const paren = vindDubbelen([
      kandidaat(1, 'Bouwbedrijf Meesters', { kvk: '12345678', postcode: '5011AA', huisnummer: '1' }),
      kandidaat(2, 'Bouwbedrijf Meesters', { kvk: '12345678', postcode: '5011AA', huisnummer: '1' }),
    ]);
    expect(paren[0]!.score).toBe(100);
    expect(paren[0]!.redenen).toEqual(['kvk', 'adres', 'naam']);
  });

  it('herkent contactpersonen op e-mailadres', () => {
    const paren = vindDubbelen([
      kandidaat(1, 'Jan de Vries', { email: 'J.deVries@meesters.local' }),
      kandidaat(2, 'J. de Vries', { email: 'j.devries@meesters.local' }),
    ]);
    expect(paren[0]!.score).toBe(100);
    expect(paren[0]!.redenen).toContain('email');
  });

  it('meldt niets bij duidelijk verschillende partijen', () => {
    expect(
      vindDubbelen([
        kandidaat(1, 'Bouwbedrijf Meesters', { kvk: '11111111', postcode: '5011AA', huisnummer: '1' }),
        kandidaat(2, 'CECI Ontwikkeling', { kvk: '22222222', postcode: '4811BB', huisnummer: '9' }),
      ]),
    ).toHaveLength(0);
  });

  it('vergelijkt elk paar maar één keer', () => {
    const paren = vindDubbelen([
      kandidaat(1, 'Alpha', { kvk: '1' }),
      kandidaat(2, 'Alpha', { kvk: '1' }),
      kandidaat(3, 'Alpha', { kvk: '1' }),
    ]);
    expect(paren).toHaveLength(3); // 1-2, 1-3, 2-3
  });

  it('sorteert de zekerste paren bovenaan', () => {
    const paren = vindDubbelen([
      kandidaat(1, 'Bouwbedrijf Meesters'),
      kandidaat(2, 'Bouwbedrijf Meesteers'),
      kandidaat(3, 'Van Dijk', { kvk: '99999999' }),
      kandidaat(4, 'Anders', { kvk: '99999999' }),
    ]);
    expect(paren[0]!.score).toBe(100);
  });

  it('laat de naamdrempel instellen', () => {
    const kandidaten = [kandidaat(1, 'Bouwbedrijf Meesters'), kandidaat(2, 'Bouwbedrijf Meester')];
    expect(vindDubbelen(kandidaten, { naamDrempel: 0.99 })).toHaveLength(0);
    expect(vindDubbelen(kandidaten, { naamDrempel: 0.8 })).toHaveLength(1);
  });
});
