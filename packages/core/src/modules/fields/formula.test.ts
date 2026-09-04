import { describe, expect, it } from 'vitest';
import { checkFormula, evaluateFormula, FormuleFout, parseFormula } from './formula.ts';

const reken = (expressie: string, context: Record<string, unknown> = {}) =>
  evaluateFormula(expressie, context as Record<string, never>);

describe('rekenen', () => {
  it('rekent de basisbewerkingen uit', () => {
    expect(reken('1 + 2')).toBe(3);
    expect(reken('10 - 4')).toBe(6);
    expect(reken('6 * 7')).toBe(42);
    expect(reken('10 / 4')).toBe(2.5);
    expect(reken('10 % 3')).toBe(1);
  });

  it('houdt zich aan de voorrangsregels', () => {
    expect(reken('2 + 3 * 4')).toBe(14);
    expect(reken('(2 + 3) * 4')).toBe(20);
    expect(reken('2 * 3 + 4 * 5')).toBe(26);
  });

  it('rekent min-tekens en haakjes goed', () => {
    expect(reken('-5 + 3')).toBe(-2);
    expect(reken('-(2 + 3)')).toBe(-5);
    expect(reken('10 - -5')).toBe(15);
  });

  it('geeft leeg in plaats van oneindig bij delen door nul', () => {
    // Een half ingevuld record mag geen "Infinity" in de lijst zetten.
    expect(reken('10 / 0')).toBeNull();
    expect(reken('10 % 0')).toBeNull();
  });

  it('is links-associatief bij aftrekken en delen', () => {
    expect(reken('10 - 3 - 2')).toBe(5);
    expect(reken('100 / 5 / 2')).toBe(10);
  });
});

describe('velden', () => {
  it('gebruikt waarden uit het record', () => {
    expect(reken('aantal * prijs', { aantal: 24, prijs: 2500 })).toBe(60_000);
  });

  it('behandelt een leeg veld als nul in een berekening', () => {
    expect(reken('aantal + 5', { aantal: null })).toBe(5);
  });

  it('weigert een veld dat niet bestaat, met een bruikbare melding', () => {
    expect(() => reken('bestaat_niet + 1', { aantal: 1 })).toThrow(
      /Het veld "bestaat_niet" bestaat niet/,
    );
  });

  it('rekent met maatwerkvelden', () => {
    expect(reken('cf_woningen * cf_prijs_per_woning', { cf_woningen: 18, cf_prijs_per_woning: 3000 })).toBe(
      54_000,
    );
  });
});

describe('vergelijken en logica', () => {
  it('vergelijkt getallen', () => {
    expect(reken('5 > 3')).toBe(true);
    expect(reken('5 <= 5')).toBe(true);
    expect(reken('5 <> 3')).toBe(true);
    expect(reken('5 = 5')).toBe(true);
  });

  it('vergelijkt teksten', () => {
    expect(reken('"appel" < "peer"')).toBe(true);
    expect(reken('"Breda" = "Breda"')).toBe(true);
  });

  it('combineert met EN en OF', () => {
    expect(reken('waar && onwaar')).toBe(false);
    expect(reken('waar || onwaar')).toBe(true);
    expect(reken('!onwaar')).toBe(true);
  });

  it('rekent de rechterkant van EN niet uit als dat niet hoeft', () => {
    // Zonder kortsluiting zou het ontbrekende veld een fout geven.
    expect(reken('onwaar && bestaat_niet')).toBe(false);
    expect(reken('waar || bestaat_niet')).toBe(true);
  });
});

describe('functies', () => {
  it('kiest met ALS', () => {
    expect(reken('ALS(aantal > 20, "groot", "klein")', { aantal: 24 })).toBe('groot');
    expect(reken('ALS(aantal > 20, "groot", "klein")', { aantal: 4 })).toBe('klein');
  });

  it('rekent de tak van ALS die niet gekozen wordt niet uit', () => {
    expect(reken('ALS(waar, 1, bestaat_niet)')).toBe(1);
    expect(reken('ALS(onwaar, bestaat_niet, 2)')).toBe(2);
  });

  it('rondt af op het gevraagde aantal decimalen', () => {
    expect(reken('ROND(3.14159, 2)')).toBe(3.14);
    expect(reken('ROND(2.5)')).toBe(3);
    expect(reken('AFRONDEN_BOVEN(2.1)')).toBe(3);
    expect(reken('AFRONDEN_BENEDEN(2.9)')).toBe(2);
  });

  it('kent MIN, MAX, SOM en GEMIDDELDE', () => {
    expect(reken('MIN(3, 1, 2)')).toBe(1);
    expect(reken('MAX(3, 1, 2)')).toBe(3);
    expect(reken('SOM(1, 2, 3, 4)')).toBe(10);
    expect(reken('GEMIDDELDE(2, 4, 6)')).toBe(4);
  });

  it('kan met tekst omgaan', () => {
    expect(reken('LENGTE("Showroom")')).toBe(8);
    expect(reken('SAMENVOEGEN("Plan ", naam)', { naam: 'CECI' })).toBe('Plan CECI');
    expect(reken('HOOFDLETTERS("breda")')).toBe('BREDA');
    expect(reken('IS_LEEG(notitie)', { notitie: null })).toBe(true);
  });

  it('accepteert de Engelse aliassen', () => {
    expect(reken('IF(1 > 0, "ja", "nee")')).toBe('ja');
    expect(reken('SUM(1, 2)')).toBe(3);
    expect(reken('ROUND(1.234, 1)')).toBe(1.2);
  });

  it('weigert een functie die niet bestaat, en noemt wat er wel is', () => {
    expect(() => reken('STIEKEM(1)')).toThrow(/bestaat niet. Beschikbaar:/);
  });
});

describe('een formule kan niets buiten zichzelf', () => {
  it('kan geen JavaScript uitvoeren', () => {
    // Er is geen eval, dus dit zijn gewoon onbekende namen of ongeldige tekens.
    for (const kwaad of [
      'process.exit(1)',
      'require("fs")',
      'globalThis.process',
      'constructor.constructor("return 1")()',
      '(() => 1)()',
    ]) {
      expect(() => reken(kwaad), kwaad).toThrow();
    }
  });

  it('kan niet bij de prototypeketen', () => {
    expect(() => reken('__proto__')).toThrow(/bestaat niet in dit record/);
    expect(() => reken('constructor', { aantal: 1 })).toThrow(/bestaat niet in dit record/);
    // Ook niet als de context zelf een gevaarlijke sleutel zou hebben.
    expect(() => reken('toString', {})).toThrow(/bestaat niet in dit record/);
  });

  it('weigert een te lange formule', () => {
    expect(() => reken(`1${' + 1'.repeat(600)}`)).toThrow(/te lang/);
  });

  it('weigert een te diep geneste formule', () => {
    expect(() => reken(`${'('.repeat(70)}1${')'.repeat(70)}`)).toThrow(/te diep genest/);
  });
});

describe('foutmeldingen zijn in het Nederlands en bruikbaar', () => {
  it('meldt een ontbrekend sluithaakje', () => {
    expect(() => reken('(1 + 2')).toThrow(/sluithaakje/);
  });

  it('meldt een niet-gesloten aanhalingsteken', () => {
    expect(() => reken('"onaf')).toThrow(/aanhalingsteken is niet gesloten/);
  });

  it('meldt een onafgemaakte formule', () => {
    expect(() => reken('1 +')).toThrow(/niet af/);
  });

  it('meldt een leeg veld', () => {
    expect(() => reken('   ')).toThrow(/leeg/);
  });

  it('meldt een onbekend teken', () => {
    expect(() => reken('1 # 2')).toThrow(/Onbekend teken/);
  });

  it('gooit altijd een FormuleFout', () => {
    expect(() => reken('1 +')).toThrow(FormuleFout);
  });
});

describe('checkFormula', () => {
  it('keurt een geldige formule goed en noemt de gebruikte velden', () => {
    const resultaat = checkFormula('ALS(aantal > 10, aantal * prijs, 0)');
    expect(resultaat).toEqual({ ok: true, velden: ['aantal', 'prijs'] });
  });

  it('keurt een ongeldige formule af met uitleg', () => {
    const resultaat = checkFormula('1 +');
    expect(resultaat.ok).toBe(false);
    if (!resultaat.ok) expect(resultaat.fout).toMatch(/niet af/);
  });

  it('ontleedt zonder uit te rekenen', () => {
    // Delen door nul is bij het controleren geen fout; het hangt van de data af.
    expect(checkFormula('a / b').ok).toBe(true);
    expect(() => parseFormula('a / b')).not.toThrow();
  });
});

describe('praktijkvoorbeeld', () => {
  it('rekent een showroomomzet per woning uit', () => {
    const context = { unit_count: 24, contract_value_cents: 6_000_000 };
    expect(reken('ROND(contract_value_cents / unit_count / 100, 2)', context)).toBe(2500);
  });

  it('toont een nette tekst bij een leeg record', () => {
    const context = { unit_count: null, contract_value_cents: null };
    expect(reken('ALS(IS_LEEG(unit_count), "onbekend", unit_count)', context)).toBe('onbekend');
  });
});

describe('checkFormula controleert ook de functienamen', () => {
  it('keurt een onbekende functie af bij het opslaan, niet pas bij het lezen', () => {
    const resultaat = checkFormula('STIEKEM(1)');
    expect(resultaat.ok).toBe(false);
    if (resultaat.ok) return;
    expect(resultaat.fout).toContain('STIEKEM bestaat niet');
    expect(resultaat.fout).toContain('Beschikbaar:');
  });

  it('noemt alle onbekende functies tegelijk', () => {
    const resultaat = checkFormula('EEN(1) + TWEE(2)');
    expect(resultaat.ok).toBe(false);
    if (resultaat.ok) return;
    expect(resultaat.fout).toContain('EEN, TWEE');
  });

  it('laat geneste bekende functies gewoon door', () => {
    expect(checkFormula('ROND(MAX(a, b) / 2, 1)')).toEqual({ ok: true, velden: ['a', 'b'] });
  });
});
