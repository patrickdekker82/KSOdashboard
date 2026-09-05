/**
 * Tests voor het uitvoeren van een preset (hoofdstuk 6.8).
 *
 * Het model wordt hier nagebootst. Dat is geen concessie: juist zó kunnen we
 * vastleggen wat er precies aan de andere kant binnenkomt, en dat is de enige
 * vraag die er bij een externe dienst echt toe doet.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import { AiFout, type Model, type Verzoek } from './client.ts';
import { bereidVoor, laadPresets, verbruikPerMaand, voerUit } from './uitvoeren.ts';

type Rij = Record<string, unknown>;

let map: string;
let handle: DatabaseHandle;

/** Wat het nagebootste model te zien kreeg. Hier kijken we naar. */
let ontvangen: Verzoek[] = [];

/** Een model dat teruggeeft wat de test wil, en onthoudt wat het kreeg. */
function nepModel(antwoord: string, tokens = { invoer: 1200, uitvoer: 300 }): Model {
  return {
    vraag: async (verzoek) => {
      ontvangen.push(verzoek);
      return {
        tekst: antwoord,
        invoertokens: tokens.invoer,
        uitvoertokens: tokens.uitvoer,
        reden: 'end_turn',
      };
    },
  };
}

function eersteId(tabel: string): number {
  const rij = handle.raw.prepare(`SELECT MIN(id) AS id FROM ${tabel}`).get() as { id: number };
  return Number(rij.id);
}

beforeEach(() => {
  ontvangen = [];
  map = mkdtempSync(join(tmpdir(), 'showroom-ai-'));
  handle = openDatabase(join(map, 'showroom.db'));
  runMigrations(handle);

  handle.raw
    .prepare(
      "INSERT INTO users (name, initials, email, password_hash) VALUES ('Patrick Dekker', 'PD', 'patrick@showroom.local', 'x')",
    )
    .run();
  handle.raw
    .prepare(
      `INSERT INTO organizations (name, email, phone, address_street, address_number, postcode, city)
       VALUES ('Bouwbedrijf Kroon', 'info@kroonbouw.nl', '030 1234567', 'Dorpsstraat', '12', '3431 CB', 'Nieuwegein')`,
    )
    .run();
  handle.raw
    .prepare(
      `INSERT INTO contacts (organization_id, first_name, infix, last_name, job_title, email, mobile, is_primary)
       VALUES (?, 'Marieke', 'de', 'Vries', 'Inkoper', 'm.devries@kroonbouw.nl', '06-12345678', 1)`,
    )
    .run(eersteId('organizations'));

  handle.raw
    .prepare(
      `INSERT INTO ai_presets (name, category, system_prompt, user_prompt_template, model, max_tokens, include_context, anonymise_personal_data)
       VALUES ('Opvolgmail', 'e-mail', 'Schrijf een korte Nederlandse opvolgmail.',
               'Schrijf een opvolgmail aan {{contact.voornaam}} van {{organisatie.naam}}.',
               'claude-opus-5', 2048, '["record","contactpersonen"]', 1)`,
    )
    .run();
});

afterEach(() => {
  handle.close();
  rmSync(map, { recursive: true, force: true });
});

describe('voorbereiden', () => {
  it('stuurt geen enkel persoonsgegeven mee', async () => {
    await voerUit(
      handle,
      nepModel('Beste «PERSOON_1», ik kom terug op onze offerte. Groet.'),
      { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
      eersteId('users'),
    );

    const verstuurd = ontvangen[0]!.gebruiker;

    expect(verstuurd).not.toContain('Marieke');
    expect(verstuurd).not.toContain('Vries');
    expect(verstuurd).not.toContain('Kroon');
    expect(verstuurd).not.toContain('kroonbouw.nl');
    expect(verstuurd).not.toContain('12345678');
    expect(verstuurd).not.toContain('Dorpsstraat');
    expect(verstuurd).not.toContain('3431 CB');
    expect(verstuurd).toContain('«');
  });

  it('zet de gegevens in het antwoord weer terug', async () => {
    const uitkomst = await voerUit(
      handle,
      nepModel('Beste «PERSOON_1», ik kom terug op onze offerte.'),
      { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
      eersteId('users'),
    );

    expect(uitkomst.tekst).toContain('Marieke');
    expect(uitkomst.tekst).not.toContain('«PERSOON_1»');
    expect(uitkomst.vervangen).toBeGreaterThan(0);
  });

  it('stuurt de gegevens wél mee als het anonimiseren uit staat', async () => {
    handle.raw.prepare('UPDATE ai_presets SET anonymise_personal_data = 0').run();

    await voerUit(
      handle,
      nepModel('Beste Marieke,'),
      { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
      eersteId('users'),
    );

    expect(ontvangen[0]!.gebruiker).toContain('Bouwbedrijf Kroon');
  });

  it('neemt de aanvulling van de gebruiker mee, en anonimiseert die ook', () => {
    const voorbereid = bereidVoor(
      handle,
      {
        presetId: eersteId('ai_presets'),
        entiteit: 'organizations',
        recordId: eersteId('organizations'),
        aanvulling: 'Noem dat Marieke de Vries dinsdag belde over de keuken.',
      },
      eersteId('users'),
    );

    expect(voorbereid.gebruiker).toContain('dinsdag belde over de keuken');
    expect(voorbereid.gebruiker).not.toContain('Marieke');
  });

  it('pakt ook een afkorting van de klantnaam uit een notitie', async () => {
    // Live gevonden: in een activiteit staat "Meesters nabellen", niet
    // "Bouwbedrijf Meesters B.V.". Zonder de losse kernwoorden lekt de naam.
    handle.raw
      .prepare("UPDATE ai_presets SET include_context = '[\"record\",\"activiteiten\"]'")
      .run();
    handle.raw
      .prepare("INSERT INTO activities (type, subject) VALUES ('bellen', 'Kroon nabellen over de keuken')")
      .run();
    handle.raw
      .prepare(
        "INSERT INTO activity_links (activity_id, entity_key, record_id) VALUES (last_insert_rowid(), 'organizations', ?)",
      )
      .run(eersteId('organizations'));

    const voorbereid = bereidVoor(
      handle,
      { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
      eersteId('users'),
    );

    expect(voorbereid.gebruiker).toContain('nabellen over de keuken');
    expect(voorbereid.gebruiker).not.toContain('Kroon');
  });

  it('laat de rechtsvorm staan — die zegt niets over wélk bedrijf het is', () => {
    handle.raw.prepare("UPDATE organizations SET name = 'Bouwbedrijf Kroon B.V.'").run();

    const voorbereid = bereidVoor(
      handle,
      { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
      eersteId('users'),
    );

    expect(voorbereid.gebruiker).not.toContain('Kroon');
  });

  it('vervangt ook de plaats', () => {
    const voorbereid = bereidVoor(
      handle,
      { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
      eersteId('users'),
    );

    expect(voorbereid.gebruiker).not.toContain('Nieuwegein');
  });

  it('neemt alleen de contextblokken die de preset vraagt', () => {
    handle.raw.prepare("UPDATE ai_presets SET include_context = '[\"record\"]'").run();
    const alleenRecord = bereidVoor(
      handle,
      { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
      eersteId('users'),
    );

    handle.raw
      .prepare("UPDATE ai_presets SET include_context = '[\"record\",\"contactpersonen\"]'")
      .run();
    const meerBlokken = bereidVoor(
      handle,
      { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
      eersteId('users'),
    );

    expect(alleenRecord.gebruiker).not.toContain('Contactpersonen');
    expect(meerBlokken.gebruiker).toContain('Contactpersonen');
  });

  it('weigert een preset die uit staat', () => {
    handle.raw.prepare('UPDATE ai_presets SET active = 0').run();

    expect(() =>
      bereidVoor(
        handle,
        { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
        eersteId('users'),
      ),
    ).toThrow(/staat uit/);
  });

  it('weigert een onderwerp waar de assistent niets mee kan', () => {
    expect(() =>
      bereidVoor(
        handle,
        { presetId: eersteId('ai_presets'), entiteit: 'absences', recordId: 1 },
        eersteId('users'),
      ),
    ).toThrow(AiFout);
  });

  it('negeert onzin in include_context in plaats van te crashen', () => {
    handle.raw.prepare("UPDATE ai_presets SET include_context = 'geen json'").run();

    const presets = laadPresets(handle);
    expect(presets[0]!.context).toEqual([]);
  });
});

describe('logboek', () => {
  it('legt een geslaagde aanroep vast, zonder promptinhoud', async () => {
    await voerUit(
      handle,
      nepModel('Beste «PERSOON_1», groet.'),
      { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
      eersteId('users'),
    );

    const rij = handle.raw.prepare('SELECT * FROM ai_runs').get() as Rij;

    expect(rij.status).toBe('ok');
    expect(rij.model).toBe('claude-opus-5');
    expect(rij.input_tokens).toBe(1200);
    expect(rij.output_tokens).toBe(300);
    expect(rij.entity_key).toBe('organizations');
    // $5 per miljoen invoer + $25 per miljoen uitvoer = 0,6 + 0,75 = 1,35 cent,
    // naar boven afgerond 2 cent.
    expect(rij.cost_estimate_cents).toBe(2);
    expect(String(rij.prompt_summary)).not.toContain('Marieke');
    expect(String(rij.prompt_summary)).toContain('Opvolgmail');
  });

  it('legt ook een mislukte aanroep vast', async () => {
    const stuk: Model = {
      vraag: async () => {
        throw new AiFout('te_druk', 'De dienst is even vol.');
      },
    };

    await expect(
      voerUit(
        handle,
        stuk,
        { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
        eersteId('users'),
      ),
    ).rejects.toThrow(AiFout);

    const rij = handle.raw.prepare('SELECT * FROM ai_runs').get() as Rij;

    expect(rij.status).toBe('fout');
    expect(String(rij.error)).toContain('te_druk');
  });

  it('telt het verbruik per maand op', async () => {
    for (let keer = 0; keer < 3; keer += 1) {
      await voerUit(
        handle,
        nepModel('Groet.'),
        { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
        eersteId('users'),
      );
    }

    const maanden = verbruikPerMaand(handle);

    expect(maanden).toHaveLength(1);
    expect(maanden[0]!.aanroepen).toBe(3);
    expect(maanden[0]!.invoer).toBe(3600);
  });
});

describe('verzonnen plaatshouders', () => {
  it('laat er eentje staan en meldt hem', async () => {
    const uitkomst = await voerUit(
      handle,
      nepModel('Beste «PERSOON_1», groet aan «PERSOON_42».'),
      { presetId: eersteId('ai_presets'), entiteit: 'organizations', recordId: eersteId('organizations') },
      eersteId('users'),
    );

    expect(uitkomst.tekst).toContain('«PERSOON_42»');
    expect(uitkomst.onbekend).toEqual(['«PERSOON_42»']);
  });
});
