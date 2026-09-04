/**
 * Tests voor de omrekening tussen invoerveld en centen.
 *
 * De gebruiker typt Nederlands en de kern rekent in hele centen. Precies daar
 * gaat het mis als iemand ooit `parseFloat` op een komma loslaat: "1.234,56"
 * wordt dan 1,234 en niemand ziet het tot een offerte er duizend euro naast zit.
 */
import { describe, expect, it } from 'vitest';
import {
  basispuntenUit,
  centenUit,
  getalUit,
  naarBasispunten,
  naarCenten,
  naarGetal,
} from './bedrag.ts';

describe('naarCenten', () => {
  it('leest een Nederlands bedrag met duizendpunt en decimaalkomma', () => {
    expect(naarCenten('1.234,56')).toBe(123456);
  });

  it('leest een bedrag zonder duizendpunt', () => {
    expect(naarCenten('1234,56')).toBe(123456);
  });

  it('leest een heel bedrag zonder komma', () => {
    expect(naarCenten('750')).toBe(75000);
  });

  it('negeert spaties en het euroteken', () => {
    expect(naarCenten(' € 1.000,00 ')).toBe(100000);
  });

  it('leest een leeg veld als nul, niet als fout', () => {
    expect(naarCenten('')).toBe(0);
    expect(naarCenten('   ')).toBe(0);
  });

  it('rondt een derde decimaal af op hele centen', () => {
    expect(naarCenten('1,005')).toBe(101);
    expect(naarCenten('1,004')).toBe(100);
  });

  // 1,005 x 100 is in drijvende komma 100,49999999999999 en rondt dus naar
  // beneden af. Deze bedragen mogen daar niet in trappen.
  it('rondt ook de bedragen goed af waar een kommagetal de mist in gaat', () => {
    expect(naarCenten('1,005')).toBe(101);
    expect(naarCenten('8,165')).toBe(817);
    expect(naarCenten('1,015')).toBe(102);
    expect(naarCenten('1234,565')).toBe(123457);
  });

  it('leest een bedrag zonder cijfers voor de komma', () => {
    expect(naarCenten(',75')).toBe(75);
  });

  it('weigert een losse komma', () => {
    expect(naarCenten(',')).toBeNull();
  });

  it('weigert tekst en dubbele komma’s', () => {
    expect(naarCenten('abc')).toBeNull();
    expect(naarCenten('1,2,3')).toBeNull();
    expect(naarCenten('12.34.56,78,9')).toBeNull();
  });

  it('leest een negatief bedrag, want een correctieregel mag negatief zijn', () => {
    expect(naarCenten('-25,50')).toBe(-2550);
  });

  it('is de omgekeerde van centenUit', () => {
    for (const centen of [0, 1, 99, 100, 123456, 999999999]) {
      expect(naarCenten(centenUit(centen))).toBe(centen);
    }
  });
});

describe('centenUit', () => {
  it('schrijft altijd twee decimalen met een komma', () => {
    expect(centenUit(123456)).toBe('1234,56');
    expect(centenUit(100)).toBe('1,00');
    expect(centenUit(5)).toBe('0,05');
    expect(centenUit(0)).toBe('0,00');
  });
});

describe('naarBasispunten', () => {
  it('rekent procenten om naar basispunten', () => {
    expect(naarBasispunten('12,5')).toBe(1250);
    expect(naarBasispunten('100')).toBe(10000);
    expect(naarBasispunten('0')).toBe(0);
  });

  it('negeert het procentteken', () => {
    expect(naarBasispunten('7,5 %')).toBe(750);
  });

  // De kolom discount_bp heeft een CHECK tussen 0 en 10000; buiten dat bereik
  // laten we de invoer hier al stranden in plaats van bij een SQL-fout.
  it('weigert een korting boven de honderd procent of onder nul', () => {
    expect(naarBasispunten('101')).toBeNull();
    expect(naarBasispunten('-5')).toBeNull();
  });

  it('weigert tekst', () => {
    expect(naarBasispunten('veel')).toBeNull();
  });

  it('is de omgekeerde van basispuntenUit', () => {
    for (const bp of [0, 250, 1250, 5000, 10000]) {
      expect(naarBasispunten(basispuntenUit(bp))).toBe(bp);
    }
  });
});

describe('naarGetal', () => {
  it('leest een aantal met decimaalkomma', () => {
    expect(naarGetal('2,5')).toBe(2.5);
    expect(naarGetal('24')).toBe(24);
  });

  it('leest een leeg veld als nul', () => {
    expect(naarGetal('')).toBe(0);
  });

  it('weigert tekst', () => {
    expect(naarGetal('twee')).toBeNull();
  });

  it('is de omgekeerde van getalUit', () => {
    for (const waarde of [0, 1, 2.5, 24, 0.5]) {
      expect(naarGetal(getalUit(waarde))).toBe(waarde);
    }
  });
});
