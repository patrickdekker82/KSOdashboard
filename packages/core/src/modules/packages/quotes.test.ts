/**
 * Tests voor offertes uit duurzaamheidspakketten (hoofdstuk 6.5).
 *
 * De prijsmodule zelf is elders getest; hier gaat het om wat er met de database
 * gebeurt. Twee dingen staan centraal: dat een offerte een kopie is en niet
 * meebeweegt met latere prijswijzigingen, en dat een optionele regel die de
 * klant niet kiest ook echt nul kost.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import {
  accepteerOfferte,
  herberekenOfferte,
  kiesOptie,
  maakOfferteVanPakket,
  OfferteFout,
  vervalVerlopenOffertes,
  verstuurOfferte,
  wijsAfOfferte,
} from './quotes.ts';

type Rij = Record<string, unknown>;

let directory: string;
let handle: DatabaseHandle;
let pakketId = 0;

const NU = new Date('2026-09-07T09:00:00Z');

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-offertes-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);

  handle.raw
    .prepare(
      "INSERT INTO users (name, initials, email, password_hash) VALUES ('Dennis', 'DM', 'd@t.local', 'x')",
    )
    .run();
  handle.raw
    .prepare(
      "INSERT INTO number_sequences (key, prefix, next_value, padding, reset_period) VALUES ('package_quotes', 'OF', 1, 4, 'jaar')",
    )
    .run();
  handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Bouwbedrijf Meesters B.V.')").run();

  // Twee producten: een paneel en een optionele optimizer.
  handle.raw
    .prepare(
      `INSERT INTO products (sku, name, unit, purchase_price_cents, sales_price_cents, vat_rate_bp)
       VALUES ('PV-445', 'Zonnepaneel 445 Wp', 'stuk', 9500, 15900, 2100)`,
    )
    .run();
  handle.raw
    .prepare(
      `INSERT INTO products (sku, name, unit, purchase_price_cents, sales_price_cents, vat_rate_bp)
       VALUES ('MNT-OPT', 'Optimizer', 'stuk', 5400, 8900, 2100)`,
    )
    .run();

  const pakket = handle.raw
    .prepare(
      "INSERT INTO packages (code, name, pricing_mode, vat_mode) VALUES ('PV10', 'Zonnepanelen 10', 'sum', 'excl')",
    )
    .run();
  pakketId = Number(pakket.lastInsertRowid);

  handle.raw
    .prepare(
      `INSERT INTO package_items (package_id, product_id, description, quantity, unit_price_cents, is_optional, sort_order)
       VALUES (?, 1, 'Zonnepaneel 445 Wp', 10, 15900, 0, 0)`,
    )
    .run(pakketId);
  handle.raw
    .prepare(
      `INSERT INTO package_items (package_id, product_id, description, quantity, unit_price_cents, is_optional, sort_order)
       VALUES (?, 2, 'Optimizer per paneel', 10, 8900, 1, 1)`,
    )
    .run(pakketId);
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

const offerte = (id: number): Rij =>
  handle.raw.prepare('SELECT * FROM package_quotes WHERE id = ?').get(id) as Rij;

const regels = (id: number): Rij[] =>
  handle.raw
    .prepare('SELECT * FROM package_quote_lines WHERE quote_id = ? ORDER BY sort_order')
    .all(id) as Rij[];

describe('een offerte samenstellen', () => {
  it('kopieert de pakketregels en geeft een nummer uit', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);

    expect(offerte(id).number).toBe('OF-2026-0001');
    expect(offerte(id).status).toBe('concept');
    expect(regels(id)).toHaveLength(2);
  });

  // Een optionele regel die aan zou staan, maakt de eerste prijs die de klant
  // ziet hoger dan het pakket belooft.
  it('zet optionele regels uitgevinkt klaar', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);

    const optie = regels(id)[1]!;
    expect(optie.is_optional).toBe(1);
    expect(optie.is_selected).toBe(0);
    expect(optie.amount_cents).toBe(0);
  });

  it('rekent het totaal zonder de niet-gekozen optie', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);

    // 10 x 159,00 = 1590,00 excl., btw 21% = 333,90
    expect(offerte(id).subtotal_cents).toBe(159_000);
    expect(offerte(id).vat_cents).toBe(33_390);
    expect(offerte(id).total_cents).toBe(192_390);
  });

  it('vermenigvuldigt de aantallen bij een offerte voor meerdere woningen', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId, aantal: 12 }, 1, NU);

    expect(regels(id)[0]?.quantity).toBe(120);
    expect(offerte(id).subtotal_cents).toBe(159_000 * 12);
  });

  it('zet de geldigheid standaard op dertig dagen', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    expect(offerte(id).valid_until).toBe('2026-10-07');
  });

  it('koppelt klant, project en kans mee', () => {
    handle.raw.prepare("INSERT INTO projects (name, unit_count) VALUES ('Plan Zuidhoek', 32)").run();
    const id = maakOfferteVanPakket(
      handle,
      { packageId: pakketId, organizationId: 1, projectId: 1 },
      1,
      NU,
    );

    expect(offerte(id)).toMatchObject({ organization_id: 1, project_id: 1, package_id: pakketId });
  });

  it('geeft elke offerte een eigen nummer', () => {
    const eerste = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    const tweede = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);

    expect(offerte(eerste).number).toBe('OF-2026-0001');
    expect(offerte(tweede).number).toBe('OF-2026-0002');
  });

  it('weigert een pakket zonder regels', () => {
    const leeg = handle.raw
      .prepare("INSERT INTO packages (code, name) VALUES ('LEEG', 'Leeg pakket')")
      .run();

    expect(() =>
      maakOfferteVanPakket(handle, { packageId: Number(leeg.lastInsertRowid) }, 1, NU),
    ).toThrow(OfferteFout);
  });

  it('weigert een aantal van nul', () => {
    expect(() => maakOfferteVanPakket(handle, { packageId: pakketId, aantal: 0 }, 1, NU)).toThrow(
      /groter dan nul/,
    );
  });

  // Dit is het punt van kopiëren: wat de klant heeft gezien, blijft staan.
  it('beweegt niet mee met een latere prijswijziging van het pakket', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    const voor = Number(offerte(id).total_cents);

    handle.raw.prepare('UPDATE package_items SET unit_price_cents = 19900 WHERE package_id = ?').run(pakketId);
    handle.raw.prepare('UPDATE products SET sales_price_cents = 19900 WHERE id = 1').run();
    herberekenOfferte(handle, id);

    expect(Number(offerte(id).total_cents)).toBe(voor);
  });
});

describe('optionele regels', () => {
  it('telt een gekozen optie mee', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    const optieId = Number(regels(id)[1]?.id);

    const totalen = kiesOptie(handle, id, optieId, true);

    // 1590,00 + 890,00 = 2480,00 excl.
    expect(totalen.subtotalCents).toBe(248_000);
    expect(Number(offerte(id).total_cents)).toBe(248_000 + 52_080);
  });

  it('haalt hem er weer uit', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    const optieId = Number(regels(id)[1]?.id);

    kiesOptie(handle, id, optieId, true);
    const totalen = kiesOptie(handle, id, optieId, false);

    expect(totalen.subtotalCents).toBe(159_000);
    expect(regels(id)[1]?.amount_cents).toBe(0);
  });

  it('weigert een verplichte regel weg te laten', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    const verplicht = Number(regels(id)[0]?.id);

    expect(() => kiesOptie(handle, id, verplicht, false)).toThrow(/kan niet worden weggelaten/);
  });

  it('weigert een regel van een andere offerte', () => {
    const eerste = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    const tweede = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    const vreemd = Number(regels(tweede)[1]?.id);

    expect(() => kiesOptie(handle, eerste, vreemd, true)).toThrow(OfferteFout);
  });
});

describe('vaste pakketprijs', () => {
  it('verdeelt het verschil over de regels zodat de btw blijft kloppen', () => {
    handle.raw
      .prepare("UPDATE packages SET pricing_mode = 'fixed', fixed_price_cents = 150000 WHERE id = ?")
      .run(pakketId);

    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);

    expect(Number(offerte(id).subtotal_cents)).toBe(150_000);
    const som = regels(id).reduce((totaal, regel) => totaal + Number(regel.amount_cents), 0);
    expect(som).toBe(150_000);
  });
});

describe('de statusstroom', () => {
  it('verstuurt een offerte en legt de datum vast', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    const uitkomst = verstuurOfferte(handle, id, 1, null, NU);

    expect(uitkomst.status).toBe('verstuurd');
    expect(offerte(id).sent_at).toBe('2026-09-07 09:00:00');
    expect(uitkomst.validUntil).toBe('2026-10-07');
  });

  it('verstuurt niet twee keer', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    verstuurOfferte(handle, id, 1, null, NU);

    expect(() => verstuurOfferte(handle, id, 1, null, NU)).toThrow(/niet opnieuw/);
  });

  it('weigert een offerte van nul euro te versturen', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    handle.raw.prepare('UPDATE package_quote_lines SET quantity = 0 WHERE quote_id = ?').run(id);
    herberekenOfferte(handle, id);

    expect(() => verstuurOfferte(handle, id, 1, null, NU)).toThrow(/nul euro/);
  });

  it('accepteert een verstuurde offerte', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    verstuurOfferte(handle, id, 1, null, NU);
    accepteerOfferte(handle, id, 1, NU);

    expect(offerte(id)).toMatchObject({ status: 'geaccepteerd', decided_at: '2026-09-07' });
  });

  it('accepteert geen concept', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    expect(() => accepteerOfferte(handle, id, 1, NU)).toThrow(/verstuurde offerte/);
  });

  it('wijst af met een reden', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    verstuurOfferte(handle, id, 1, null, NU);
    wijsAfOfferte(handle, id, null, 'Klant koos voor een andere leverancier', 1, NU);

    expect(offerte(id).status).toBe('afgewezen');
    expect(String(offerte(id).internal_notes)).toContain('andere leverancier');
  });

  it('wijst niet af zonder reden of toelichting', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    verstuurOfferte(handle, id, 1, null, NU);

    expect(() => wijsAfOfferte(handle, id, null, null, 1, NU)).toThrow(/reden/);
  });

  // Zonder dit blijft een offerte van vorig jaar in de trechter staan alsof er
  // nog antwoord op kan komen.
  it('laat een verlopen offerte vervallen', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    verstuurOfferte(handle, id, 1, '2026-09-20', NU);

    expect(vervalVerlopenOffertes(handle, new Date('2026-09-15T09:00:00Z'))).toBe(0);
    expect(vervalVerlopenOffertes(handle, new Date('2026-09-25T09:00:00Z'))).toBe(1);
    expect(offerte(id).status).toBe('vervallen');
  });

  it('laat een geaccepteerde offerte niet vervallen', () => {
    const id = maakOfferteVanPakket(handle, { packageId: pakketId }, 1, NU);
    verstuurOfferte(handle, id, 1, '2026-09-20', NU);
    accepteerOfferte(handle, id, 1, NU);

    expect(vervalVerlopenOffertes(handle, new Date('2026-09-25T09:00:00Z'))).toBe(0);
    expect(offerte(id).status).toBe('geaccepteerd');
  });
});
