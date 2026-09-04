import { describe, expect, it } from 'vitest';
import type { FieldDefinition, FieldType } from '@showroom/shared';
import { coerceValue, computeFormulaFields, validateCustomFields } from './validation.ts';

function veld(overrides: Partial<FieldDefinition> & { type: FieldType }): FieldDefinition {
  return {
    id: 1,
    entityKey: 'projects',
    fieldKey: 'cf_test',
    label: 'Testveld',
    storage: 'json',
    isSystem: false,
    isLocked: false,
    required: false,
    uniqueValue: false,
    validation: {},
    indexed: false,
    sortOrder: 0,
    visibleInList: true,
    visibleInDetail: true,
    editable: true,
    ...overrides,
  };
}

const keur = (
  definities: FieldDefinition[],
  binnen: Record<string, unknown>,
  opties: () => string[] | null = () => null,
) => validateCustomFields(definities, binnen, opties);

describe('waarden omzetten', () => {
  it('leest Nederlandse getalnotatie', () => {
    expect(coerceValue('number', '1.234,56')).toBe(1234.56);
    expect(coerceValue('currency', '2500')).toBe(2500);
    expect(coerceValue('integer', '24')).toBe(24);
  });

  it('leest ja-en-nee in meerdere vormen', () => {
    expect(coerceValue('boolean', 'ja')).toBe(true);
    expect(coerceValue('boolean', 'true')).toBe(true);
    expect(coerceValue('boolean', '1')).toBe(true);
    expect(coerceValue('boolean', 'nee')).toBe(false);
  });

  it('maakt van een losse waarde een lijst bij meerkeuze', () => {
    expect(coerceValue('multiselect', 'a')).toEqual(['a']);
    expect(coerceValue('multiselect', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('beschouwt lege invoer als niets', () => {
    expect(coerceValue('text', '')).toBeNull();
    expect(coerceValue('number', null)).toBeNull();
    expect(coerceValue('multiselect', [])).toBeNull();
  });
});

describe('verplichte velden', () => {
  it('weigert een leeg verplicht veld met de naam erbij', () => {
    const resultaat = keur([veld({ type: 'text', required: true, label: 'Bouwstroom' })], {
      cf_test: '',
    });
    expect(resultaat.ok).toBe(false);
    if (resultaat.ok) return;
    expect(resultaat.fouten[0]!.melding).toBe('"Bouwstroom" is verplicht.');
  });

  it('klaagt niet over een verplicht veld dat al gevuld is en niet wijzigt', () => {
    // Bij een PATCH met alleen een ander veld mag een bestaande waarde blijven.
    const resultaat = validateCustomFields(
      [veld({ type: 'text', required: true })],
      {},
      () => null,
      { cf_test: 'bestaande waarde' },
    );
    expect(resultaat.ok).toBe(true);
  });
});

describe('per type', () => {
  it('controleert lengte en patroon bij tekst', () => {
    const definitie = veld({
      type: 'text',
      validation: { minLength: 3, maxLength: 5, pattern: '^[A-Z]+$', patternMessage: 'Alleen hoofdletters.' },
    });
    expect(keur([definitie], { cf_test: 'AB' }).ok).toBe(false);
    expect(keur([definitie], { cf_test: 'ABCDEF' }).ok).toBe(false);
    expect(keur([definitie], { cf_test: 'abc' }).ok).toBe(false);
    expect(keur([definitie], { cf_test: 'ABC' }).ok).toBe(true);
  });

  it('geeft de eigen patroonmelding terug', () => {
    const resultaat = keur(
      [veld({ type: 'text', validation: { pattern: '^[A-Z]+$', patternMessage: 'Alleen hoofdletters.' } })],
      { cf_test: 'abc' },
    );
    expect(resultaat.ok).toBe(false);
    if (resultaat.ok) return;
    expect(resultaat.fouten[0]!.melding).toBe('Alleen hoofdletters.');
  });

  it('controleert grenzen bij getallen', () => {
    const definitie = veld({ type: 'number', validation: { min: 0, max: 100 } });
    expect(keur([definitie], { cf_test: -1 }).ok).toBe(false);
    expect(keur([definitie], { cf_test: 101 }).ok).toBe(false);
    expect(keur([definitie], { cf_test: 50 }).ok).toBe(true);
  });

  it('staat geen decimalen toe bij een heel getal', () => {
    expect(keur([veld({ type: 'integer' })], { cf_test: 2.5 }).ok).toBe(false);
    expect(keur([veld({ type: 'integer' })], { cf_test: 2 }).ok).toBe(true);
  });

  it('weigert tekst waar een getal hoort', () => {
    const resultaat = keur([veld({ type: 'number' })], { cf_test: 'geen getal' });
    expect(resultaat.ok).toBe(false);
    if (resultaat.ok) return;
    expect(resultaat.fouten[0]!.melding).toBe('Vul een getal in.');
  });

  it('controleert datum, tijd en datum-tijd', () => {
    expect(keur([veld({ type: 'date' })], { cf_test: '2026-03-02' }).ok).toBe(true);
    expect(keur([veld({ type: 'date' })], { cf_test: '02-03-2026' }).ok).toBe(false);
    expect(keur([veld({ type: 'time' })], { cf_test: '09:30' }).ok).toBe(true);
    expect(keur([veld({ type: 'time' })], { cf_test: '25:00' }).ok).toBe(false);
    expect(keur([veld({ type: 'datetime' })], { cf_test: '2026-03-02T09:30' }).ok).toBe(true);
  });

  it('controleert e-mail, telefoon en webadres', () => {
    expect(keur([veld({ type: 'email' })], { cf_test: 'jan@meesters.local' }).ok).toBe(true);
    expect(keur([veld({ type: 'email' })], { cf_test: 'jan-apenstaartje' }).ok).toBe(false);
    expect(keur([veld({ type: 'phone' })], { cf_test: '+31 6 12345678' }).ok).toBe(true);
    expect(keur([veld({ type: 'url' })], { cf_test: 'https://voorbeeld.nl' }).ok).toBe(true);
  });

  it('weigert een javascript-adres in een webadresveld', () => {
    // Dat veld wordt klikbaar getoond, dus hier hoort geen script in te kunnen.
    const resultaat = keur([veld({ type: 'url' })], { cf_test: 'javascript:alert(1)' });
    expect(resultaat.ok).toBe(false);
  });

  it('controleert een kleur', () => {
    expect(keur([veld({ type: 'color' })], { cf_test: '#2563eb' }).ok).toBe(true);
    expect(keur([veld({ type: 'color' })], { cf_test: 'blauw' }).ok).toBe(false);
  });

  it('controleert een verwijzing op een geldig id', () => {
    expect(keur([veld({ type: 'relation' })], { cf_test: 12 }).ok).toBe(true);
    expect(keur([veld({ type: 'relation' })], { cf_test: 0 }).ok).toBe(false);
    expect(keur([veld({ type: 'user' })], { cf_test: 'Patrick' }).ok).toBe(false);
  });
});

describe('keuzelijsten', () => {
  const opties = () => ['A', 'B', 'C'];

  it('accepteert alleen keuzes die in de lijst staan', () => {
    expect(keur([veld({ type: 'select' })], { cf_test: 'A' }, opties).ok).toBe(true);
    expect(keur([veld({ type: 'select' })], { cf_test: 'Z' }, opties).ok).toBe(false);
  });

  it('controleert elke keuze bij meerkeuze en noemt de onbekende', () => {
    const resultaat = keur([veld({ type: 'multiselect' })], { cf_test: ['A', 'Z'] }, opties);
    expect(resultaat.ok).toBe(false);
    if (resultaat.ok) return;
    expect(resultaat.fouten[0]!.melding).toContain('Z');
  });

  it('laat alles door wanneer de bron geen lijst kent', () => {
    expect(keur([veld({ type: 'select' })], { cf_test: 'wat dan ook' }).ok).toBe(true);
  });
});

describe('onbekende velden', () => {
  it('weigert een sleutel die niet in het register staat', () => {
    const resultaat = keur([veld({ type: 'text' })], { cf_bestaat_niet: 'x' });
    expect(resultaat.ok).toBe(false);
    if (resultaat.ok) return;
    expect(resultaat.fouten[0]!.melding).toContain('bestaat niet (meer)');
  });

  it('negeert een gearchiveerd veld', () => {
    const resultaat = keur([veld({ type: 'text', archivedAt: '2026-01-01' })], { cf_test: 'x' });
    expect(resultaat.ok).toBe(false);
  });
});

describe('formulevelden', () => {
  const formule = veld({
    type: 'formula',
    fieldKey: 'cf_prijs_per_woning',
    label: 'Prijs per woning',
    validation: { expression: 'ROND(contract_value_cents / unit_count / 100, 2)' },
  });

  it('kan niet worden ingevuld', () => {
    const resultaat = keur([formule], { cf_prijs_per_woning: 999 });
    expect(resultaat.ok).toBe(false);
    if (resultaat.ok) return;
    expect(resultaat.fouten[0]!.melding).toContain('wordt berekend');
  });

  it('wordt bij het lezen uitgerekend', () => {
    const { waarden, fouten } = computeFormulaFields([formule], {
      unit_count: 24,
      contract_value_cents: 6_000_000,
    });
    expect(waarden.cf_prijs_per_woning).toBe(2500);
    expect(fouten).toEqual({});
  });

  it('laat een kapotte formule het record niet slopen', () => {
    const kapot = veld({
      type: 'formula',
      fieldKey: 'cf_kapot',
      validation: { expression: 'bestaat_niet * 2' },
    });
    const { waarden, fouten } = computeFormulaFields([kapot], { unit_count: 24 });
    expect(waarden.cf_kapot).toBeNull();
    expect(fouten.cf_kapot).toContain('bestaat niet');
  });

  it('geeft de formule geen toegang tot niet-eenvoudige waarden', () => {
    // Alleen tekst, getal, ja/nee en leeg gaan de context in.
    const kapot = veld({
      type: 'formula',
      fieldKey: 'cf_kapot',
      validation: { expression: 'gevaarlijk' },
    });
    const { fouten } = computeFormulaFields([kapot], { gevaarlijk: { iets: 'objects' } });
    expect(fouten.cf_kapot).toContain('bestaat niet');
  });
});

describe('meerdere fouten tegelijk', () => {
  it('meldt alles in één keer in plaats van één voor één', () => {
    const resultaat = keur(
      [
        veld({ id: 1, fieldKey: 'cf_een', type: 'number', label: 'Een' }),
        veld({ id: 2, fieldKey: 'cf_twee', type: 'email', label: 'Twee' }),
      ],
      { cf_een: 'geen getal', cf_twee: 'ook geen adres' },
    );
    expect(resultaat.ok).toBe(false);
    if (resultaat.ok) return;
    expect(resultaat.fouten).toHaveLength(2);
    expect(resultaat.fouten.map((fout) => fout.label)).toEqual(['Een', 'Twee']);
  });
});
