/**
 * Tests voor het maandbudget van de assistent (hoofdstuk 6.8).
 *
 * De handleiding beloofde dit al voordat het bestond. Het gaat om één ding: een
 * waarschuwing achteraf is geen budget. De grens moet vóór het netwerk liggen,
 * anders is het geld al uitgegeven op het moment dat iemand het ziet.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import { AiFout, type Model } from './client.ts';
import { leesBudget, voerUit, WAARSCHUWING_VANAF } from './uitvoeren.ts';

let map: string;
let handle: DatabaseHandle;

/** Een model dat altijd hetzelfde antwoordt; de kosten regelen we via tokens. */
const nepModel: Model = {
  vraag: async () => ({
    tekst: 'Beste relatie, groet.',
    invoertokens: 200_000, // 200k invoer = 100 dollarcent bij Opus 5
    uitvoertokens: 0,
    reden: 'end_turn',
  }),
};

function zetBudget(centen: number): void {
  handle.raw
    .prepare("INSERT INTO settings (key, value) VALUES ('ai', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ maandbudget_cents: centen }));
}

/** Boekt een uitgave in het logboek, alsof er al gedraaid is. */
function alUitgegeven(centen: number, maandVerschuiving = 0): void {
  const datum = new Date();
  datum.setUTCMonth(datum.getUTCMonth() + maandVerschuiving);
  handle.raw
    .prepare(
      `INSERT INTO ai_runs (preset_id, user_id, model, cost_estimate_cents, created_at)
       VALUES (1, 1, 'claude-opus-5', ?, ?)`,
    )
    .run(centen, `${datum.toISOString().slice(0, 10)} 12:00:00`);
}

function eersteId(tabel: string): number {
  return Number((handle.raw.prepare(`SELECT MIN(id) AS id FROM ${tabel}`).get() as { id: number }).id);
}

beforeEach(() => {
  map = mkdtempSync(join(tmpdir(), 'showroom-budget-'));
  handle = openDatabase(join(map, 'showroom.db'));
  runMigrations(handle);

  handle.raw
    .prepare("INSERT INTO users (name, initials, email, password_hash) VALUES ('Patrick', 'PD', 'p@x.local', 'x')")
    .run();
  handle.raw.prepare("INSERT INTO organizations (name, city) VALUES ('Kroon B.V.', 'Nieuwegein')").run();
  handle.raw
    .prepare(
      `INSERT INTO ai_presets (name, system_prompt, user_prompt_template, include_context, anonymise_personal_data)
       VALUES ('Test', 'Schrijf iets.', 'Schrijf iets.', '["record"]', 1)`,
    )
    .run();
});

afterEach(() => {
  handle.close();
  rmSync(map, { recursive: true, force: true });
});

describe('het budget lezen', () => {
  it('meldt geen grens als er geen budget staat', () => {
    const budget = leesBudget(handle);

    expect(budget.grensCenten).toBeNull();
    expect(budget.percentage).toBeNull();
    expect(budget.op).toBe(false);
    expect(budget.bijnaOp).toBe(false);
  });

  it('behandelt nul als "geen budget" en niet als "meteen op"', () => {
    // Anders legt een beheerder die het veld leeghaalt de assistent stil.
    zetBudget(0);

    expect(leesBudget(handle).grensCenten).toBeNull();
    expect(leesBudget(handle).op).toBe(false);
  });

  it('telt op wat er deze maand is uitgegeven', () => {
    zetBudget(1000);
    alUitgegeven(150);
    alUitgegeven(100);

    const budget = leesBudget(handle);

    expect(budget.besteedCenten).toBe(250);
    expect(budget.percentage).toBe(25);
  });

  it('laat een vorige maand buiten beschouwing', () => {
    zetBudget(1000);
    alUitgegeven(900, -1);
    alUitgegeven(100);

    expect(leesBudget(handle).besteedCenten).toBe(100);
  });

  it('waarschuwt vanaf tachtig procent, maar weigert dan nog niet', () => {
    zetBudget(1000);
    alUitgegeven(WAARSCHUWING_VANAF * 10);

    const budget = leesBudget(handle);

    expect(budget.bijnaOp).toBe(true);
    expect(budget.op).toBe(false);
  });

  it('is op zodra de grens bereikt is', () => {
    zetBudget(1000);
    alUitgegeven(1000);

    expect(leesBudget(handle).op).toBe(true);
    expect(leesBudget(handle).bijnaOp).toBe(false);
  });

  it('valt terug op geen budget bij een onleesbare instelling', () => {
    handle.raw.prepare("INSERT INTO settings (key, value) VALUES ('ai', 'geen json')").run();

    expect(leesBudget(handle).grensCenten).toBeNull();
  });
});

describe('de grens afdwingen', () => {
  const opdracht = () => ({
    presetId: eersteId('ai_presets'),
    entiteit: 'organizations',
    recordId: eersteId('organizations'),
  });

  it('laat een aanroep door zolang er ruimte is', async () => {
    zetBudget(10_000);

    const uitkomst = await voerUit(handle, nepModel, opdracht(), eersteId('users'));

    expect(uitkomst.tekst).toContain('groet');
    expect(uitkomst.budget.besteedCenten).toBe(100);
  });

  it('weigert vóórdat het verzoek de deur uit gaat als het budget op is', async () => {
    zetBudget(500);
    alUitgegeven(500);

    let gezien = false;
    const model: Model = {
      vraag: async () => {
        gezien = true;
        throw new Error('had niet aangeroepen mogen worden');
      },
    };

    await expect(voerUit(handle, model, opdracht(), eersteId('users'))).rejects.toThrow(/budget/);
    // Dit is het hele punt: het model is niet aangeroepen, dus er is niets
    // uitgegeven en er zijn ook geen gegevens verstuurd.
    expect(gezien).toBe(false);
  });

  it('noemt in de melding wat er op staat en wat de grens is', async () => {
    zetBudget(500);
    alUitgegeven(600);

    await expect(voerUit(handle, nepModel, opdracht(), eersteId('users'))).rejects.toThrow(
      /US\$ 6,00 van US\$ 5,00/,
    );
  });

  it('gebruikt de foutcode budget_op, zodat het scherm er iets mee kan', async () => {
    zetBudget(100);
    alUitgegeven(100);

    await expect(voerUit(handle, nepModel, opdracht(), eersteId('users'))).rejects.toMatchObject({
      code: 'budget_op',
    });
  });

  it('laat alles door zolang er geen budget is ingesteld', async () => {
    alUitgegeven(1_000_000);

    const uitkomst = await voerUit(handle, nepModel, opdracht(), eersteId('users'));

    expect(uitkomst.budget.grensCenten).toBeNull();
  });

  it('gooit een AiFout en geen kale Error', async () => {
    zetBudget(100);
    alUitgegeven(100);

    await expect(voerUit(handle, nepModel, opdracht(), eersteId('users'))).rejects.toBeInstanceOf(
      AiFout,
    );
  });
});
