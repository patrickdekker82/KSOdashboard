import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import { herberekenKans } from './recalculate.ts';
import {
  dagenTussen,
  KansFout,
  maakProjectVanKans,
  verliesKans,
  verouderdeKansen,
  winKans,
  wisselFase,
  tijdstempel,
} from './stages.ts';
import { doorlooptijdPerFase, samenvatting, trechter, verliesredenen, winRate } from './reports.ts';

let directory: string;
let handle: DatabaseHandle;

/** Fase-ids, gevuld door de opzet hieronder. */
let kwalificatie = 0;
let offerte = 0;
let gewonnenFase = 0;
let verlorenFase = 0;
let tegelwerk = 0;
let keuken = 0;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-kansen-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);

  handle.raw
    .prepare("INSERT INTO users (name, initials, email, password_hash) VALUES ('Test', 'TT', 't@t.local', 'x')")
    .run();
  handle.raw.prepare("INSERT INTO pipelines (name, is_default) VALUES ('Verkoop', 1)").run();

  const fase = (naam: string, volgorde: number, kans: number, won = 0, lost = 0, rotting: number | null = null): number => {
    handle.raw
      .prepare(
        `INSERT INTO pipeline_stages (pipeline_id, name, sort_order, default_probability_bp, is_won, is_lost, rotting_days)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(naam, volgorde, kans, won, lost, rotting);
    return Number((handle.raw.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
  };

  kwalificatie = fase('Kwalificatie', 0, 1000, 0, 0, 30);
  offerte = fase('Offerte uit', 1, 5000, 0, 0, 21);
  gewonnenFase = fase('Gewonnen', 2, 10_000, 1, 0);
  verlorenFase = fase('Verloren', 3, 0, 0, 1);

  const discipline = (code: string, naam: string): number => {
    handle.raw.prepare('INSERT INTO disciplines (code, name) VALUES (?, ?)').run(code, naam);
    return Number((handle.raw.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
  };
  tegelwerk = discipline('TEG', 'Tegelwerk');
  keuken = discipline('KEU', 'Keuken');
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Maakt een kans met twee disciplineregels. */
function maakKans(overrides: Record<string, unknown> = {}): number {
  const kolommen = { name: 'Plan Zuidhoek', pipeline_id: 1, stage_id: kwalificatie, ...overrides };
  const namen = Object.keys(kolommen);
  handle.raw
    .prepare(`INSERT INTO opportunities (${namen.join(', ')}) VALUES (${namen.map(() => '?').join(', ')})`)
    .run(...(Object.values(kolommen) as never[]));
  const id = Number((handle.raw.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);

  regel(id, tegelwerk, 24, 185_000);
  regel(id, keuken, 24, 650_000);
  herberekenKans(handle, id);
  return id;
}

function regel(kansId: number, disciplineId: number, aantal: number, prijs: number, korting = 0): number {
  handle.raw
    .prepare(
      `INSERT INTO opportunity_lines (opportunity_id, discipline_id, quantity, unit_price_cents, discount_bp, cost_price_cents)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .run(kansId, disciplineId, aantal, prijs, korting);
  return Number((handle.raw.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id);
}

const kansRij = (id: number): Record<string, unknown> =>
  handle.raw.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as Record<string, unknown>;

// ---------------------------------------------------------------------------

describe('afgeleide bedragen', () => {
  it('rekent regelbedrag, kansbedrag en gewogen bedrag uit', () => {
    const id = maakKans({ probability_bp: 5000 });
    const kans = kansRij(id);

    // 24 x 1.850 + 24 x 6.500 = 200.400 euro
    expect(kans.amount_cents).toBe(24 * 185_000 + 24 * 650_000);
    expect(kans.weighted_amount_cents).toBe((24 * 185_000 + 24 * 650_000) / 2);
  });

  it('valt terug op de fasedefault als de kans zelf geen kans heeft', () => {
    const id = maakKans({ stage_id: offerte }); // fasedefault 50%
    expect(kansRij(id).weighted_amount_cents).toBe((24 * 185_000 + 24 * 650_000) / 2);
  });

  it('past korting per regel toe', () => {
    const id = maakKans({ probability_bp: 10_000 });
    regel(id, tegelwerk, 10, 100_000, 1000); // 10% korting
    herberekenKans(handle, id);
    const regels = handle.raw
      .prepare('SELECT amount_cents FROM opportunity_lines WHERE opportunity_id = ? ORDER BY id')
      .all(id) as Array<{ amount_cents: number }>;
    expect(regels[2]!.amount_cents).toBe(900_000);
  });

  it('telt een gearchiveerde regel niet meer mee', () => {
    const id = maakKans({ probability_bp: 10_000 });
    const eerste = handle.raw
      .prepare('SELECT id FROM opportunity_lines WHERE opportunity_id = ? ORDER BY id LIMIT 1')
      .get(id) as { id: number };

    handle.raw
      .prepare("UPDATE opportunity_lines SET archived_at = datetime('now') WHERE id = ?")
      .run(eerste.id);
    herberekenKans(handle, id);

    expect(kansRij(id).amount_cents).toBe(24 * 650_000);
  });

  it('geeft null terug voor een kans die niet bestaat', () => {
    expect(herberekenKans(handle, 999)).toBeNull();
  });
});

describe('fasewisselingen', () => {
  it('verplaatst de kans en legt de wissel vast', () => {
    const id = maakKans();
    const resultaat = wisselFase(handle, id, offerte, 1);

    expect(resultaat).toMatchObject({ vanFase: kwalificatie, naarFase: offerte, status: 'open' });
    expect(kansRij(id).stage_id).toBe(offerte);

    const historie = handle.raw
      .prepare('SELECT * FROM opportunity_stage_history WHERE opportunity_id = ?')
      .all(id) as Array<Record<string, unknown>>;
    expect(historie).toHaveLength(1);
    expect(historie[0]).toMatchObject({ from_stage_id: kwalificatie, to_stage_id: offerte });
  });

  // De rest van het schema schrijft tijdstempels met datetime('now'). Zou deze
  // module ISO-tekst met een "T" wegschrijven, dan staan er twee vormen in
  // dezelfde kolom en gaat elke sortering of BETWEEN daarover een keer mis.
  it('schrijft tijdstempels in dezelfde vorm als de rest van het schema', () => {
    const id = maakKans();
    wisselFase(handle, id, offerte, 1, new Date('2026-09-15T08:30:00Z'));

    const patroon = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    expect(String(kansRij(id).stage_changed_at)).toMatch(patroon);

    const historie = handle.raw
      .prepare('SELECT at FROM opportunity_stage_history WHERE opportunity_id = ?')
      .get(id) as { at: string };
    expect(historie.at).toBe('2026-09-15 08:30:00');

    // En de vorm die win/verlies via datetime('now') schrijft, ziet er net zo uit.
    const nu = handle.raw.prepare("SELECT datetime('now') AS nu").get() as { nu: string };
    expect(nu.nu).toMatch(patroon);
  });

  it('houdt tijdstempel en dagenTussen op elkaar aangesloten', () => {
    const heen = new Date('2026-03-29T12:00:00Z');
    expect(dagenTussen(tijdstempel(heen), new Date('2026-04-08T12:00:00Z'))).toBe(10);
  });

  it('rekent uit hoe lang de kans in de vorige fase stond', () => {
    const id = maakKans();
    handle.raw
      .prepare("UPDATE opportunities SET stage_changed_at = ? WHERE id = ?")
      .run('2026-09-01T00:00:00.000Z', id);

    const resultaat = wisselFase(handle, id, offerte, 1, new Date('2026-09-15T00:00:00Z'));
    expect(resultaat.dagenInVorigeFase).toBe(14);
  });

  it('neemt de kans van de fase over, maar overschrijft geen eigen inschatting', () => {
    const zonder = maakKans();
    wisselFase(handle, zonder, offerte, 1);
    expect(kansRij(zonder).probability_bp).toBe(5000); // fasedefault

    const met = maakKans({ probability_bp: 7500 });
    wisselFase(handle, met, offerte, 1);
    expect(kansRij(met).probability_bp).toBe(7500); // eigen inschatting blijft
  });

  it('doet niets bij een wissel naar dezelfde fase', () => {
    const id = maakKans();
    wisselFase(handle, id, kwalificatie, 1);
    expect(
      handle.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_stage_history').get(),
    ).toEqual({ n: 0 });
  });

  it('weigert een onbekende fase of kans', () => {
    const id = maakKans();
    expect(() => wisselFase(handle, id, 999, 1)).toThrow(KansFout);
    expect(() => wisselFase(handle, 999, offerte, 1)).toThrow(/bestaat niet/);
  });
});

describe('winnen', () => {
  it('legt per regel het gescoorde bedrag vast', () => {
    const id = maakKans();
    const regels = handle.raw
      .prepare('SELECT id FROM opportunity_lines WHERE opportunity_id = ? ORDER BY id')
      .all(id) as Array<{ id: number }>;

    const resultaat = winKans(
      handle,
      id,
      [
        { lineId: regels[0]!.id, wonAmountCents: 4_000_000 },
        { lineId: regels[1]!.id, wonAmountCents: 15_000_000 },
      ],
      1,
    );

    expect(resultaat.wonAmountCents).toBe(19_000_000);
    expect(kansRij(id)).toMatchObject({ status: 'won', probability_bp: 10_000 });
    expect(kansRij(id).won_amount_cents).toBe(19_000_000);
  });

  it('markeert regels die niet gescoord zijn als verloren', () => {
    // Bij een gewonnen kans hoort per discipline een uitspraak; anders klopt
    // de omzet per discipline niet.
    const id = maakKans();
    const regels = handle.raw
      .prepare('SELECT id FROM opportunity_lines WHERE opportunity_id = ? ORDER BY id')
      .all(id) as Array<{ id: number }>;

    winKans(handle, id, [{ lineId: regels[0]!.id, wonAmountCents: 4_000_000 }], 1);

    const na = handle.raw
      .prepare('SELECT id, status, won_amount_cents FROM opportunity_lines WHERE opportunity_id = ? ORDER BY id')
      .all(id) as Array<{ status: string; won_amount_cents: number }>;
    expect(na[0]!.status).toBe('won');
    expect(na[1]!.status).toBe('lost');
    expect(na[1]!.won_amount_cents).toBe(0);
  });

  it('zet de kans in de winfase en legt dat vast in de historie', () => {
    const id = maakKans();
    winKans(handle, id, [], 1);
    expect(kansRij(id).stage_id).toBe(gewonnenFase);
    expect(
      handle.raw.prepare('SELECT COUNT(*) AS n FROM opportunity_stage_history').get(),
    ).toEqual({ n: 1 });
  });

  it('weigert een regel die niet bij deze kans hoort', () => {
    const id = maakKans();
    const andere = maakKans();
    const vreemd = handle.raw
      .prepare('SELECT id FROM opportunity_lines WHERE opportunity_id = ? LIMIT 1')
      .get(andere) as { id: number };

    expect(() => winKans(handle, id, [{ lineId: vreemd.id, wonAmountCents: 100 }], 1)).toThrow(
      /hoort niet bij deze kans/,
    );
  });

  it('weigert een negatief bedrag', () => {
    const id = maakKans();
    const regels = handle.raw
      .prepare('SELECT id FROM opportunity_lines WHERE opportunity_id = ? LIMIT 1')
      .get(id) as { id: number };
    expect(() => winKans(handle, id, [{ lineId: regels.id, wonAmountCents: -1 }], 1)).toThrow(
      /niet negatief/,
    );
  });
});

describe('een project maken van een gewonnen kans', () => {
  it('vult het project en de showroomfase voor uit de kans', () => {
    const id = maakKans({
      expected_units: 32,
      expected_showroom_start: '2026-03-02',
      expected_showroom_end: '2026-04-26',
    });
    // De fasesoort moet bestaan, anders komt er geen fase.
    handle.raw.prepare("INSERT INTO picklists (key, name) VALUES ('projectfase', 'Projectfase')").run();
    handle.raw
      .prepare("INSERT INTO picklist_items (picklist_id, value, label) VALUES (1, 'showroom', 'Showroom')")
      .run();

    const projectId = maakProjectVanKans(handle, id, 1);

    const project = handle.raw.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<
      string,
      unknown
    >;
    expect(project).toMatchObject({ name: 'Plan Zuidhoek', unit_count: 32, counts_as_showroom: 1 });

    const fasen = handle.raw
      .prepare('SELECT * FROM project_phases WHERE project_id = ?')
      .all(projectId) as Array<Record<string, unknown>>;
    expect(fasen).toHaveLength(1);
    expect(fasen[0]).toMatchObject({
      start_date: '2026-03-02',
      end_date: '2026-04-26',
      is_capacity_load: 1,
    });

    // De kans wijst nu naar het project.
    expect(kansRij(id).project_id).toBe(projectId);
  });

  it('maakt geen fase als de kans geen verwachte periode heeft', () => {
    // Een geraden fase belandt ongemerkt in de capaciteitsberekening.
    const id = maakKans({ expected_units: 10 });
    const projectId = maakProjectVanKans(handle, id, 1);
    expect(
      handle.raw.prepare('SELECT COUNT(*) AS n FROM project_phases WHERE project_id = ?').get(projectId),
    ).toEqual({ n: 0 });
  });

  it('weigert een tweede project bij dezelfde kans', () => {
    const id = maakKans();
    maakProjectVanKans(handle, id, 1);
    expect(() => maakProjectVanKans(handle, id, 1)).toThrow(/al een project/);
  });
});

describe('verliezen', () => {
  it('vraagt om een reden', () => {
    const id = maakKans();
    expect(() => verliesKans(handle, id, null, null, 1)).toThrow(/verliesreden/);
    expect(() => verliesKans(handle, id, null, '   ', 1)).toThrow(KansFout);
  });

  it('accepteert een toelichting in plaats van een reden uit de lijst', () => {
    const id = maakKans();
    expect(() => verliesKans(handle, id, null, 'Project is afgeblazen', 1)).not.toThrow();
    expect(kansRij(id)).toMatchObject({ status: 'lost', loss_note: 'Project is afgeblazen' });
  });

  it('zet alle regels op verloren en de kans op nul', () => {
    const id = maakKans();
    verliesKans(handle, id, null, 'Naar de concurrent', 1);

    expect(kansRij(id).stage_id).toBe(verlorenFase);
    expect(kansRij(id).probability_bp).toBe(0);
    expect(kansRij(id).won_amount_cents).toBe(0);
    const regels = handle.raw
      .prepare('SELECT status FROM opportunity_lines WHERE opportunity_id = ?')
      .all(id) as Array<{ status: string }>;
    expect(regels.every((rij) => rij.status === 'lost')).toBe(true);

    // Ook een verlies is een fasewissel en hoort in de historie.
    const historie = handle.raw
      .prepare('SELECT to_stage_id FROM opportunity_stage_history WHERE opportunity_id = ?')
      .all(id) as Array<{ to_stage_id: number }>;
    expect(historie.at(-1)?.to_stage_id).toBe(verlorenFase);
  });
});

describe('veroudering', () => {
  it('meldt een kans die langer stilstaat dan de fase toestaat', () => {
    const id = maakKans({ stage_id: offerte }); // rotting_days 21
    handle.raw
      .prepare("UPDATE opportunities SET stage_changed_at = ?, created_at = ? WHERE id = ?")
      .run('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', id);

    const verouderd = verouderdeKansen(handle, new Date('2026-09-15T00:00:00Z'));
    expect(verouderd).toHaveLength(1);
    expect(verouderd[0]).toMatchObject({ id, stage: 'Offerte uit', rottingDays: 21 });
    expect(verouderd[0]!.dagenStil).toBe(45);
  });

  it('rekent een recente activiteit mee als teken van leven', () => {
    const id = maakKans({ stage_id: offerte });
    handle.raw
      .prepare("UPDATE opportunities SET stage_changed_at = ?, last_activity_at = ? WHERE id = ?")
      .run('2026-08-01T00:00:00.000Z', '2026-09-14T00:00:00.000Z', id);

    expect(verouderdeKansen(handle, new Date('2026-09-15T00:00:00Z'))).toHaveLength(0);
  });

  it('kijkt niet naar gesloten kansen', () => {
    const id = maakKans({ stage_id: offerte });
    handle.raw
      .prepare("UPDATE opportunities SET stage_changed_at = ?, status = 'won' WHERE id = ?")
      .run('2026-01-01T00:00:00.000Z', id);
    expect(verouderdeKansen(handle, new Date('2026-09-15T00:00:00Z'))).toHaveLength(0);
  });

  it('rekent dagen nooit negatief', () => {
    expect(dagenTussen('2026-09-20T00:00:00.000Z', new Date('2026-09-15T00:00:00Z'))).toBe(0);
    expect(dagenTussen(null, new Date())).toBeNull();
  });
});

describe('rapportage', () => {
  beforeEach(() => {
    // Twee gewonnen, één verloren, één open.
    const een = maakKans({ stage_id: offerte, owner_user_id: 1 });
    const regels = handle.raw
      .prepare('SELECT id FROM opportunity_lines WHERE opportunity_id = ? ORDER BY id')
      .all(een) as Array<{ id: number }>;
    winKans(handle, een, [{ lineId: regels[0]!.id, wonAmountCents: 4_000_000 }], 1);

    const twee = maakKans({ stage_id: offerte, owner_user_id: 1 });
    verliesKans(handle, twee, null, 'Te duur', 1);

    maakKans({ stage_id: kwalificatie, owner_user_id: 1, probability_bp: 2500 });
  });

  it('toont de trechter met alleen open fasen', () => {
    const fasen = trechter(handle);
    expect(fasen.map((fase) => fase.fase)).toEqual(['Kwalificatie', 'Offerte uit']);
    expect(fasen[0]!.aantal).toBe(1);
    expect(fasen[0]!.bedragCents).toBeGreaterThan(0);
  });

  it('rekent de win-rate per discipline op regelniveau', () => {
    const perDiscipline = winRate(handle, 'discipline');
    const tegels = perDiscipline.find((rij) => rij.label === 'Tegelwerk')!;
    const keukens = perDiscipline.find((rij) => rij.label === 'Keuken')!;

    // Tegelwerk: 1 gewonnen, 1 verloren. Keuken: 0 gewonnen, 2 verloren.
    expect(tegels).toMatchObject({ gewonnen: 1, verloren: 1, winRatePct: 50 });
    expect(tegels.gescoordCents).toBe(4_000_000);
    expect(keukens.winRatePct).toBe(0);
  });

  it('rekent de win-rate per eigenaar', () => {
    const perEigenaar = winRate(handle, 'eigenaar');
    expect(perEigenaar[0]).toMatchObject({ label: 'Test', gewonnen: 1, verloren: 1, winRatePct: 50 });
  });

  it('geeft geen win-rate terug als er niets is afgesloten', () => {
    handle.raw.prepare("UPDATE opportunities SET status = 'open'").run();
    expect(winRate(handle, 'eigenaar')).toHaveLength(0);
  });

  it('rapporteert de doorlooptijd per fase met gemiddelde en mediaan', () => {
    handle.raw.prepare('UPDATE opportunity_stage_history SET days_in_stage = 10 WHERE id = 1').run();
    handle.raw.prepare('UPDATE opportunity_stage_history SET days_in_stage = 40 WHERE id = 2').run();

    const doorlooptijd = doorlooptijdPerFase(handle);
    const uitOfferte = doorlooptijd.find((rij) => rij.fase === 'Offerte uit');
    expect(uitOfferte?.metingen).toBe(2);
    expect(uitOfferte?.gemiddeldeDagen).toBe(25);
    expect(uitOfferte?.medianeDagen).toBe(25);
  });

  it('somt de verliesredenen op', () => {
    const redenen = verliesredenen(handle);
    expect(redenen).toHaveLength(1);
    expect(redenen[0]).toMatchObject({ reden: 'Geen reden opgegeven', aantal: 1 });
    expect(redenen[0]!.gemistCents).toBeGreaterThan(0);
  });

  it('vat de pipeline samen voor de KPI-balk', () => {
    const cijfers = samenvatting(handle, new Date().getUTCFullYear());
    expect(cijfers.openAantal).toBe(1);
    expect(cijfers.openCents).toBeGreaterThan(0);
    expect(cijfers.gewogenCents).toBeLessThan(cijfers.openCents);
    expect(cijfers.winRatePct).toBe(50);
    expect(cijfers.gescoordDitJaarCents).toBe(4_000_000);
    expect(cijfers.gemiddeldeDealCents).toBe(4_000_000);
  });
});
