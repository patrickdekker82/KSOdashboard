import { describe, expect, it } from 'vitest';
import { formatCurrency, lineAmountCents, roundCents, type PackageItemInput } from '@showroom/shared';
import { distributeProportionally, marginBelowMinimum, pricePackage } from './pricing.ts';

function item(overrides: Partial<PackageItemInput> = {}): PackageItemInput {
  return {
    description: 'Zonnepaneel 445 Wp',
    quantity: 10,
    unitPriceCents: 12_500, // EUR 125,00
    discountBp: 0,
    vatRateBp: 2100,
    costPriceCents: 8_000,
    isOptional: false,
    ...overrides,
  };
}

describe('regelbedragen in centen', () => {
  it('rondt pas aan het einde af', () => {
    // 3 x EUR 33,33 met 10% korting = 8999,1 cent -> 8999 cent.
    expect(lineAmountCents(3, 3_333, 1000)).toBe(8_999);
  });

  it('rekent zonder floatafwijking bij een derde', () => {
    expect(lineAmountCents(3, 3_333)).toBe(9_999);
    expect(roundCents(0.1 + 0.2)).toBe(0);
  });

  it('past korting in basispunten toe', () => {
    expect(lineAmountCents(1, 10_000, 0)).toBe(10_000);
    expect(lineAmountCents(1, 10_000, 1500)).toBe(8_500);
    expect(lineAmountCents(1, 10_000, 10_000)).toBe(0);
  });
});

describe('pricing_mode = sum', () => {
  it('telt de regels op en berekent BTW per regel', () => {
    const price = pricePackage({
      pricingMode: 'sum',
      vatMode: 'excl',
      items: [item(), item({ description: 'Omvormer', quantity: 1, unitPriceCents: 85_000 })],
    });
    expect(price.subtotalCents).toBe(125_000 + 85_000);
    expect(price.vatCents).toBe(26_250 + 17_850);
    expect(price.totalExclVatCents).toBe(210_000);
    expect(price.totalInclVatCents).toBe(210_000 + 44_100);
    // Intl zet een harde spatie (U+00A0) tussen het euroteken en het bedrag.
    expect(formatCurrency(price.totalInclVatCents)).toBe('\u20ac\u00a02.541,00');
  });

  it('rekent gemengde BTW-tarieven per regel apart', () => {
    const price = pricePackage({
      pricingMode: 'sum',
      vatMode: 'excl',
      items: [
        item({ quantity: 1, unitPriceCents: 100_000, vatRateBp: 2100 }),
        item({ description: 'Arbeid', quantity: 1, unitPriceCents: 100_000, vatRateBp: 900 }),
        item({ description: 'Vrijgesteld', quantity: 1, unitPriceCents: 100_000, vatRateBp: 0 }),
      ],
    });
    expect(price.vatCents).toBe(21_000 + 9_000 + 0);
    expect(price.totalInclVatCents).toBe(300_000 + 30_000);
  });

  it('behandelt prijzen inclusief BTW volgens vatMode', () => {
    const price = pricePackage({
      pricingMode: 'sum',
      vatMode: 'incl',
      items: [item({ quantity: 1, unitPriceCents: 121_000, vatRateBp: 2100 })],
    });
    expect(price.totalInclVatCents).toBe(121_000);
    expect(price.totalExclVatCents).toBe(121_000 - 25_410);
  });
});

describe('pricing_mode = sum_with_margin', () => {
  it('telt de marge in basispunten bij het subtotaal op', () => {
    const price = pricePackage({
      pricingMode: 'sum_with_margin',
      marginBp: 2500, // 25%
      vatMode: 'excl',
      items: [item({ quantity: 1, unitPriceCents: 100_000, costPriceCents: 80_000 })],
    });
    expect(price.subtotalCents).toBe(125_000);
    expect(price.costCents).toBe(80_000);
    expect(price.marginCents).toBe(45_000);
    expect(price.vatCents).toBe(26_250);
  });
});

describe('pricing_mode = fixed', () => {
  it('houdt de vaste prijs aan en toont de resulterende marge', () => {
    const price = pricePackage({
      pricingMode: 'fixed',
      fixedPriceCents: 200_000,
      vatMode: 'excl',
      items: [
        item({ quantity: 1, unitPriceCents: 150_000, costPriceCents: 100_000 }),
        item({ description: 'Montage', quantity: 1, unitPriceCents: 90_000, costPriceCents: 50_000 }),
      ],
    });
    expect(price.subtotalCents).toBe(200_000);
    expect(price.fixedAdjustmentCents).toBe(200_000 - 240_000); // korting van EUR 400
    expect(price.costCents).toBe(150_000);
    expect(price.marginCents).toBe(50_000);
    expect(price.marginBp).toBe(2500); // 25%
  });

  it('verdeelt het verschil naar rato zodat de BTW per tarief blijft kloppen', () => {
    const price = pricePackage({
      pricingMode: 'fixed',
      fixedPriceCents: 100_000,
      vatMode: 'excl',
      items: [
        item({ quantity: 1, unitPriceCents: 150_000, vatRateBp: 2100 }),
        item({ description: 'Arbeid', quantity: 1, unitPriceCents: 50_000, vatRateBp: 900 }),
      ],
    });
    // 150.000 : 50.000 wordt 75.000 : 25.000.
    expect(price.lines[0]!.amountCents).toBe(75_000);
    expect(price.lines[1]!.amountCents).toBe(25_000);
    expect(price.subtotalCents).toBe(100_000);
    expect(price.vatCents).toBe(15_750 + 2_250);
  });

  it('laat de regelbedragen exact optellen tot de vaste prijs, ook bij restcenten', () => {
    const price = pricePackage({
      pricingMode: 'fixed',
      fixedPriceCents: 100_000,
      vatMode: 'excl',
      items: [
        item({ quantity: 1, unitPriceCents: 33_333 }),
        item({ quantity: 1, unitPriceCents: 33_333 }),
        item({ quantity: 1, unitPriceCents: 33_333 }),
      ],
    });
    const som = price.lines.reduce((sum, line) => sum + line.amountCents, 0);
    expect(som).toBe(100_000);
    expect(price.subtotalCents).toBe(100_000);
  });
});

describe('optionele regels', () => {
  it('telt een niet-gekozen optionele regel niet mee', () => {
    const price = pricePackage({
      pricingMode: 'sum',
      vatMode: 'excl',
      items: [
        item({ quantity: 1, unitPriceCents: 100_000 }),
        item({ description: 'Extra paneel', quantity: 1, unitPriceCents: 50_000, isOptional: true }),
      ],
    });
    expect(price.lines).toHaveLength(1);
    expect(price.subtotalCents).toBe(100_000);
  });

  it('herberekent het totaal zodra de klant de optie aanvinkt', () => {
    const price = pricePackage({
      pricingMode: 'sum',
      vatMode: 'excl',
      items: [
        item({ quantity: 1, unitPriceCents: 100_000 }),
        item({
          description: 'Extra paneel',
          quantity: 1,
          unitPriceCents: 50_000,
          isOptional: true,
          isSelected: true,
        }),
      ],
    });
    expect(price.lines).toHaveLength(2);
    expect(price.subtotalCents).toBe(150_000);
  });
});

describe('marge', () => {
  it('berekent de marge in euro en basispunten', () => {
    const price = pricePackage({
      pricingMode: 'sum',
      vatMode: 'excl',
      items: [item({ quantity: 10, unitPriceCents: 12_500, costPriceCents: 8_000 })],
    });
    expect(price.costCents).toBe(80_000);
    expect(price.marginCents).toBe(45_000);
    expect(price.marginBp).toBe(3600); // 45.000 / 125.000
  });

  it('waarschuwt onder de minimummarge', () => {
    const price = pricePackage({
      pricingMode: 'sum',
      vatMode: 'excl',
      items: [item({ quantity: 1, unitPriceCents: 100_000, costPriceCents: 95_000 })],
    });
    expect(price.marginBp).toBe(500);
    expect(marginBelowMinimum(price, 1500)).toBe(true);
    expect(marginBelowMinimum(price, 400)).toBe(false);
  });

  it('gaat om met een lege regellijst', () => {
    const price = pricePackage({ pricingMode: 'sum', vatMode: 'excl', items: [] });
    expect(price.subtotalCents).toBe(0);
    expect(price.totalInclVatCents).toBe(0);
    expect(price.marginBp).toBe(0);
  });
});

describe('distributeProportionally', () => {
  it('telt altijd exact op tot het doel', () => {
    for (const target of [100_000, 99_999, 1, 0, 7]) {
      const result = distributeProportionally([33_333, 33_333, 33_334], target);
      expect(result.reduce((sum, value) => sum + value, 0)).toBe(target);
    }
  });

  it('legt alles op de eerste regel wanneer er niets te schalen valt', () => {
    expect(distributeProportionally([0, 0], 500)).toEqual([500, 0]);
  });
});
