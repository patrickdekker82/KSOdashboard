/**
 * Tests voor de afdrukbare offerte.
 *
 * Dit is de enige plek waar gegevens van een klant in HTML terechtkomen, dus de
 * ontsnapping is geen bijzaak: een klant die "Jansen & Zn <BV>" heet mag de
 * offerte niet stukmaken. Verder gaat het erom dat een niet-gekozen optie niet
 * in de tabel staat maar wel als suggestie eronder — dat is het hele punt van
 * een optie.
 */
import { describe, expect, it } from 'vitest';
import { offerteHtml } from './offerte-pdf.ts';
import type { Offerte, Offerteregel } from '../../lib/api.ts';

const OFFERTE: Offerte = {
  id: 1,
  number: 'OF-2026-0001',
  status: 'verstuurd',
  organization_id: 1,
  contact_id: null,
  project_id: null,
  opportunity_id: null,
  package_id: 1,
  sent_at: '2026-09-07 09:00:00',
  valid_until: '2026-10-07',
  decided_at: null,
  subtotal_cents: 159_000,
  discount_cents: 0,
  vat_cents: 33_390,
  total_cents: 192_390,
  notes: 'Levering in overleg.',
  internal_notes: null,
  klant: 'Bouwbedrijf Meesters B.V.',
  first_name: 'Peter',
  last_name: 'Meesters',
  project: 'Plan Zuidhoek',
  pakket: 'Zonnepanelen 10',
  eigenaar: 'Patrick Dekker',
};

function regel(overschrijving: Partial<Offerteregel> = {}): Offerteregel {
  return {
    id: 1,
    quote_id: 1,
    product_id: 1,
    sku: 'PV-445',
    categorie: 'Zonnepanelen',
    description: 'Zonnepaneel 445 Wp',
    quantity: 10,
    unit: 'stuk',
    unit_price_cents: 15_900,
    discount_bp: 0,
    vat_rate_bp: 2100,
    amount_cents: 159_000,
    cost_price_cents: 9_500,
    is_optional: 0,
    is_selected: 1,
    sort_order: 0,
    ...overschrijving,
  };
}

describe('de afdrukbare offerte', () => {
  it('zet nummer, klant en bedragen erin', () => {
    const html = offerteHtml(OFFERTE, [regel()]);

    expect(html).toContain('OF-2026-0001');
    expect(html).toContain('Bouwbedrijf Meesters B.V.');
    expect(html).toContain('Plan Zuidhoek');
    // Nederlandse notatie, met een vaste spatie na het euroteken.
    expect(html).toContain('1.923,90');
  });

  it('zet de verstuurdatum en de geldigheid erbij', () => {
    const html = offerteHtml(OFFERTE, [regel()]);
    expect(html).toContain('07-09-2026');
    expect(html).toContain('07-10-2026');
  });

  it('noemt een concept een concept', () => {
    const html = offerteHtml({ ...OFFERTE, status: 'concept', sent_at: null }, [regel()]);
    expect(html).toContain('Concept');
  });

  // Een klantnaam met een ampersand of punthaken mag de offerte niet stukmaken.
  it('ontsnapt tekst die uit de database komt', () => {
    const html = offerteHtml({ ...OFFERTE, klant: 'Jansen & Zn <BV>' }, [
      regel({ description: '<script>alert(1)</script>' }),
    ]);

    expect(html).toContain('Jansen &amp; Zn &lt;BV&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('laat een niet-gekozen optie uit de tabel maar noemt hem eronder', () => {
    const html = offerteHtml(OFFERTE, [
      regel(),
      regel({
        id: 2,
        description: 'Thuisbatterij 10 kWh',
        is_optional: 1,
        is_selected: 0,
        amount_cents: 0,
        quantity: 1,
        unit_price_cents: 619_000,
      }),
    ]);

    expect(html).toContain('Niet gekozen opties');
    expect(html).toContain('Thuisbatterij 10 kWh');
    // Het bedrag van de optie staat er als suggestie, niet als regelbedrag.
    expect(html).toContain('6.190,00');
  });

  it('laat een gekozen optie gewoon in de tabel staan', () => {
    const html = offerteHtml(OFFERTE, [
      regel(),
      regel({ id: 2, description: 'Optimizer', is_optional: 1, is_selected: 1, amount_cents: 89_000 }),
    ]);

    expect(html).not.toContain('Niet gekozen opties');
    expect(html).toContain('Optimizer');
  });

  it('toont de korting alleen als er korting is', () => {
    expect(offerteHtml(OFFERTE, [regel()])).not.toContain('Waarvan korting');
    expect(offerteHtml({ ...OFFERTE, discount_cents: 5000 }, [regel()])).toContain(
      'Waarvan korting',
    );
  });

  // Een offerte die bij de een op wit en bij de ander op donkergrijs uitkomt
  // omdat het scherm in donkere modus stond, is geen offerte.
  it('gebruikt geen enkele themavariabele', () => {
    const html = offerteHtml(OFFERTE, [regel()]);
    expect(html).not.toContain('var(--');
  });

  it('zet de voorwaarden onderaan', () => {
    expect(offerteHtml(OFFERTE, [regel()])).toContain('Levering in overleg.');
  });
});
