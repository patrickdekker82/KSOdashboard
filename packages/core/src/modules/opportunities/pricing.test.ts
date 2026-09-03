import { describe, expect, it } from 'vitest';
import {
  effectiveProbabilityBp,
  priceOpportunity,
  wonAmountByDiscipline,
  type OpportunityLineInput,
} from './pricing.ts';

function line(overrides: Partial<OpportunityLineInput> = {}): OpportunityLineInput {
  return {
    disciplineId: 1,
    quantity: 24,
    unitPriceCents: 250_000, // EUR 2.500 per woning
    discountBp: 0,
    costPriceCents: 180_000,
    status: 'open',
    ...overrides,
  };
}

describe('kansbedragen', () => {
  it('telt de regelbedragen op tot het kansbedrag', () => {
    const price = priceOpportunity({
      lines: [line(), line({ disciplineId: 2, quantity: 24, unitPriceCents: 120_000 })],
      probabilityBp: 5000,
      stageProbabilityBp: 2500,
    });
    expect(price.lines[0]!.amountCents).toBe(6_000_000);
    expect(price.lines[1]!.amountCents).toBe(2_880_000);
    expect(price.amountCents).toBe(8_880_000);
  });

  it('weegt met de kans per regel', () => {
    const price = priceOpportunity({
      lines: [line({ probabilityBp: 7500 })],
      probabilityBp: 5000,
      stageProbabilityBp: 2500,
    });
    expect(price.weightedAmountCents).toBe(4_500_000); // 6.000.000 x 0,75
  });

  it('valt terug van regelkans op kanskans op fasedefault', () => {
    expect(effectiveProbabilityBp(line({ probabilityBp: 7500 }), 5000, 2500)).toBe(7500);
    expect(effectiveProbabilityBp(line(), 5000, 2500)).toBe(5000);
    expect(effectiveProbabilityBp(line(), null, 2500)).toBe(2500);
  });

  it('past de terugval ook echt toe in de weging', () => {
    const viaKans = priceOpportunity({
      lines: [line()],
      probabilityBp: 5000,
      stageProbabilityBp: 2500,
    });
    expect(viaKans.weightedAmountCents).toBe(3_000_000);

    const viaFase = priceOpportunity({
      lines: [line()],
      probabilityBp: null,
      stageProbabilityBp: 2500,
    });
    expect(viaFase.weightedAmountCents).toBe(1_500_000);
  });

  it('past korting per regel toe', () => {
    const price = priceOpportunity({
      lines: [line({ discountBp: 1000 })],
      probabilityBp: 10_000,
      stageProbabilityBp: 2500,
    });
    expect(price.lines[0]!.amountCents).toBe(5_400_000);
  });
});

describe('winnen en verliezen', () => {
  it('telt een gewonnen regel voor 100% mee, ook zonder expliciet bedrag', () => {
    const price = priceOpportunity({
      lines: [line({ status: 'won' })],
      probabilityBp: 2500,
      stageProbabilityBp: 1000,
    });
    expect(price.weightedAmountCents).toBe(6_000_000);
    expect(price.wonAmountCents).toBe(6_000_000);
  });

  it('gebruikt het daadwerkelijk gescoorde bedrag wanneer dat is ingevuld', () => {
    const price = priceOpportunity({
      lines: [line({ status: 'won', wonAmountCents: 5_500_000 })],
      probabilityBp: 2500,
      stageProbabilityBp: 1000,
    });
    expect(price.wonAmountCents).toBe(5_500_000);
    expect(price.weightedAmountCents).toBe(5_500_000);
  });

  it('waardeert een verloren regel op nul', () => {
    const price = priceOpportunity({
      lines: [line({ status: 'lost' }), line({ disciplineId: 2, status: 'won' })],
      probabilityBp: 5000,
      stageProbabilityBp: 2500,
    });
    expect(price.weightedAmountCents).toBe(6_000_000);
    expect(price.lostAmountCents).toBe(6_000_000);
  });

  it('rapporteert gescoorde omzet per discipline', () => {
    const price = priceOpportunity({
      lines: [
        line({ disciplineId: 1, status: 'won' }),
        line({ disciplineId: 2, quantity: 10, unitPriceCents: 100_000, status: 'won' }),
        line({ disciplineId: 3, status: 'lost' }),
      ],
      probabilityBp: 5000,
      stageProbabilityBp: 2500,
    });
    const perDiscipline = wonAmountByDiscipline(price);
    expect(perDiscipline.get(1)).toBe(6_000_000);
    expect(perDiscipline.get(2)).toBe(1_000_000);
    expect(perDiscipline.has(3)).toBe(false);
  });
});

describe('marge op kansregels', () => {
  it('berekent kostprijs en marge per regel', () => {
    const price = priceOpportunity({
      lines: [line()],
      probabilityBp: 5000,
      stageProbabilityBp: 2500,
    });
    expect(price.costCents).toBe(4_320_000); // 24 x 180.000
    expect(price.marginCents).toBe(1_680_000);
  });
});
