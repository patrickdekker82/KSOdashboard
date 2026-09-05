/**
 * Tests voor het herkennen van kolommen en het lezen van celwaarden.
 *
 * Dit is de plek waar een planningsbestand van een mens de database in gaat, en
 * dus de plek waar stille fouten ontstaan: 03-02-2026 als 2 maart lezen, of
 * "1.250" als duizend tweehonderdvijftig én als 1,25 kunnen betekenen.
 */
import { describe, expect, it } from 'vitest';
import {
  leesDatum,
  leesGetal,
  leesTekst,
  normaliseerKop,
  stelKoppelingVoor,
} from './mapping.ts';

describe('kolommen herkennen', () => {
  it('herkent de gewone Nederlandse koppen', () => {
    const koppeling = stelKoppelingVoor([
      'Projectnummer',
      'Projectnaam',
      'Plaats',
      'Aantal woningen',
      'Showroom start',
      'Showroom eind',
      'Kopersbegeleider',
    ]);

    expect(koppeling).toEqual({
      nummer: 0,
      naam: 1,
      plaats: 2,
      aantal: 3,
      showroom_start: 4,
      showroom_eind: 5,
      begeleider: 6,
    });
  });

  it('trekt zich niets aan van hoofdletters, punten en spaties', () => {
    const koppeling = stelKoppelingVoor(['PROJECT NR.', 'naam', 'Aantal won.']);
    expect(koppeling.nummer).toBe(0);
    expect(koppeling.naam).toBe(1);
    expect(koppeling.aantal).toBe(2);
  });

  // "Start bouw" bevat "start", maar "Showroom start" is een exacte treffer en
  // hoort dus te winnen. Anders komt de startdatum van de bouw in de
  // showroomplanning terecht.
  it('laat een exacte treffer winnen van een gedeeltelijke', () => {
    const koppeling = stelKoppelingVoor(['Projectnaam', 'Start bouw', 'Showroom start']);
    expect(koppeling.showroom_start).toBe(2);
  });

  it('koppelt één kolom nooit aan twee velden', () => {
    const koppeling = stelKoppelingVoor(['Naam', 'Start', 'Eind']);
    const gebruikt = Object.values(koppeling);
    expect(new Set(gebruikt).size).toBe(gebruikt.length);
  });

  it('laat een veld ongekoppeld als er geen kolom voor is', () => {
    const koppeling = stelKoppelingVoor(['Projectnaam', 'Aantal woningen']);
    expect(koppeling.showroom_start).toBeUndefined();
    expect(koppeling.begeleider).toBeUndefined();
  });

  it('slaat lege koppen over', () => {
    const koppeling = stelKoppelingVoor(['Projectnaam', null, '', 'Plaats']);
    expect(koppeling.naam).toBe(0);
    expect(koppeling.plaats).toBe(3);
  });

  it('haalt accenten uit een kop', () => {
    expect(normaliseerKop('Aantal wóningen')).toBe('aantalwoningen');
  });
});

describe('getallen lezen', () => {
  it('leest een getal dat al een getal is', () => {
    expect(leesGetal(32).waarde).toBe(32);
  });

  it('leest een Nederlands getal met duizendpunt en decimaalkomma', () => {
    expect(leesGetal('1.250,5').waarde).toBe(1250.5);
  });

  // Zonder komma is een punt hier een duizendteken: 1.250 woningen bestaat,
  // 1,25 woning niet.
  it('leest een punt zonder komma als duizendteken', () => {
    expect(leesGetal('1.250').waarde).toBe(1250);
  });

  it('negeert spaties en het euroteken', () => {
    expect(leesGetal(' € 1.250 ').waarde).toBe(1250);
  });

  it('leest een lege cel als niets, niet als nul', () => {
    expect(leesGetal(null).waarde).toBeNull();
    expect(leesGetal('  ').waarde).toBeNull();
  });

  it('meldt wat er staat als het geen getal is', () => {
    const gelezen = leesGetal('ongeveer 30');
    expect(gelezen.waarde).toBeNull();
    expect(gelezen.fout).toContain('ongeveer 30');
  });
});

describe('datums lezen', () => {
  it('leest een Nederlandse datum', () => {
    expect(leesDatum('02-03-2026').waarde).toBe('2026-03-02');
    expect(leesDatum('2-3-2026').waarde).toBe('2026-03-02');
    expect(leesDatum('02/03/2026').waarde).toBe('2026-03-02');
  });

  it('leest een ISO-datum', () => {
    expect(leesDatum('2026-03-02').waarde).toBe('2026-03-02');
  });

  // Dit is het geval waar het stil misgaat: 03-02-2026 is hier 3 februari en
  // niet 2 maart. Beide getallen zijn onder de dertien, dus aan de waarde is
  // niets te zien.
  it('leest dag-eerst en niet maand-eerst', () => {
    expect(leesDatum('03-02-2026').waarde).toBe('2026-02-03');
  });

  it('vult een jaartal van twee cijfers aan', () => {
    expect(leesDatum('02-03-26').waarde).toBe('2026-03-02');
    expect(leesDatum('02-03-95').waarde).toBe('1995-03-02');
  });

  it('weigert een datum die niet bestaat', () => {
    expect(leesDatum('31-02-2026').fout).toContain('bestaat niet');
    expect(leesDatum('02-13-2026').fout).toContain('maand 13');
  });

  // De xlsx-lezer zet datumcellen al om; blijft er een kaal getal over, dan
  // stond de celopmaak niet op datum en dat moet de gebruiker weten.
  it('legt uit dat een kaal getal geen datum is', () => {
    expect(leesDatum(46083).fout).toContain('celopmaak');
  });

  it('meldt wat er staat bij onleesbare tekst', () => {
    expect(leesDatum('medio maart').fout).toContain('medio maart');
  });

  it('leest een lege cel als niets', () => {
    expect(leesDatum(null).waarde).toBeNull();
    expect(leesDatum('').waarde).toBeNull();
  });
});

describe('tekst lezen', () => {
  it('haalt spaties eraf', () => {
    expect(leesTekst('  Plan Zuidhoek  ').waarde).toBe('Plan Zuidhoek');
  });

  it('maakt van een lege cel niets in plaats van een lege tekst', () => {
    expect(leesTekst('   ').waarde).toBeNull();
  });

  it('leest een getal in een tekstkolom gewoon als tekst', () => {
    expect(leesTekst(26001).waarde).toBe('26001');
  });
});
