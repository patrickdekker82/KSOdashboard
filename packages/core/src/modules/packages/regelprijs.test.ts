/**
 * De verkoopprijs van een pakketregel.
 *
 * Het punt van de marge op regelniveau: je kent de inkoopprijs en de marge die
 * erop moet, en de verkoopprijs volgt daaruit — ook nog als de leverancier zijn
 * prijs wijzigt.
 */
import { describe, expect, it } from 'vitest';
import { regelPrijs } from './routes.ts';

describe('regelPrijs', () => {
  it('rekent de verkoopprijs uit de inkoopprijs plus de marge', () => {
    // 100,00 inkoop met 25% marge wordt 125,00.
    expect(regelPrijs({ margin_bp: 2500, purchase_price_cents: 10_000 })).toBe(12_500);
  });

  it('rondt af op hele centen', () => {
    // 33,33 met 15% is 38,3295 — dat wordt 38,33 en geen breuk.
    expect(regelPrijs({ margin_bp: 1500, purchase_price_cents: 3333 })).toBe(3833);
  });

  it('laat een marge van nul de inkoopprijs zijn', () => {
    expect(regelPrijs({ margin_bp: 0, purchase_price_cents: 8000 })).toBe(8000);
  });

  it('gebruikt de ingevulde verkoopprijs zolang er geen marge staat', () => {
    expect(
      regelPrijs({ margin_bp: null, unit_price_cents: 9950, purchase_price_cents: 5000 }),
    ).toBe(9950);
  });

  it('valt zonder marge en zonder eigen prijs terug op de productprijs', () => {
    expect(
      regelPrijs({ margin_bp: null, unit_price_cents: 0, sales_price_cents: 7500 }),
    ).toBe(7500);
  });

  it('behandelt een ontbrekende kolom als geen marge', () => {
    // Zo gedraagt een pakket van vóór deze migratie zich: ongewijzigd.
    expect(regelPrijs({ unit_price_cents: 4200 })).toBe(4200);
  });
});
