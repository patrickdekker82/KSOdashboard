/**
 * Tests voor de planningimport (hoofdstuk 11).
 *
 * Twee dingen staan hier centraal. Ten eerste dat een droogloop echt droog is:
 * na een voorbeeld mag er geen project bij zijn gekomen. En ten tweede dat een
 * tweede import van hetzelfde bestand niets dubbel doet — dat is precies wat er
 * gebeurt als iemand het bestand voor de zekerheid nog een keer inleest.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import { beoordeel, type ImportOpties } from './planning.ts';
import type { CelWaarde } from './xlsx.ts';

let directory: string;
let handle: DatabaseHandle;
let showroomFase = 0;

const KOPPEN = [
  'Projectnummer',
  'Projectnaam',
  'Plaats',
  'Aantal woningen',
  'Showroom start',
  'Showroom eind',
  'Kopersbegeleider',
];

const OPTIES: ImportOpties = {
  kopregel: 1,
  koppeling: {
    nummer: 0,
    naam: 1,
    plaats: 2,
    aantal: 3,
    showroom_start: 4,
    showroom_eind: 5,
    begeleider: 6,
  },
  bestaandeBijwerken: true,
};

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-import-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);

  handle.raw
    .prepare(
      "INSERT INTO users (name, initials, email, password_hash) VALUES ('Dennis', 'DM', 'd@t.local', 'x')",
    )
    .run();
  handle.raw
    .prepare(
      "INSERT INTO organizations (name) VALUES ('Bouwbedrijf Meesters B.V.')",
    )
    .run();
  handle.raw.prepare("INSERT INTO picklists (key, name) VALUES ('projectfase', 'Projectfase')").run();
  const fase = handle.raw
    .prepare(
      `INSERT INTO picklist_items (picklist_id, value, label)
       VALUES ((SELECT id FROM picklists WHERE key = 'projectfase'), 'showroom', 'Showroom')`,
    )
    .run();
  showroomFase = Number(fase.lastInsertRowid);
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

function rijen(...gegevens: CelWaarde[][]): CelWaarde[][] {
  return [KOPPEN, ...gegevens];
}

const projecten = (): Array<Record<string, unknown>> =>
  handle.raw.prepare('SELECT * FROM projects ORDER BY id').all() as Array<Record<string, unknown>>;

const fasen = (): Array<Record<string, unknown>> =>
  handle.raw.prepare('SELECT * FROM project_phases ORDER BY id').all() as Array<
    Record<string, unknown>
  >;

describe('droogloop', () => {
  it('beoordeelt een nieuwe rij als nieuw en schrijft niets weg', () => {
    const beoordeling = beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      false,
    );

    expect(beoordeling.nieuw).toBe(1);
    expect(beoordeling.fout).toBe(0);
    expect(projecten()).toHaveLength(0);
  });

  it('slaat lege regels onderaan het bestand over', () => {
    const beoordeling = beoordeel(
      handle,
      rijen(
        ['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM'],
        [null, null, null, null, null, null, null],
        ['', '', '', '', '', '', ''],
      ),
      OPTIES,
      1,
      false,
    );

    expect(beoordeling.totaal).toBe(1);
  });

  it('verwijst in een melding naar de regel in het bestand', () => {
    const beoordeling = beoordeel(
      handle,
      rijen(
        ['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM'],
        ['P26002', '', 'Houten', 18, '2026-06-01', '2026-07-24', 'DM'],
      ),
      OPTIES,
      1,
      false,
    );

    const fout = beoordeling.rijen.find((rij) => rij.oordeel === 'fout');
    expect(fout?.bronregel).toBe(3);
  });
});

describe('doorvoeren', () => {
  it('maakt het project met de showroomfase en de begeleider aan', () => {
    beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      true,
    );

    const alle = projecten();
    expect(alle).toHaveLength(1);
    expect(alle[0]).toMatchObject({
      number: 'P26001',
      name: 'Plan Zuidhoek',
      city: 'Nieuwegein',
      unit_count: 32,
    });

    const fase = fasen();
    expect(fase).toHaveLength(1);
    expect(fase[0]).toMatchObject({
      phase_type_id: showroomFase,
      start_date: '2026-03-02',
      end_date: '2026-05-29',
      is_capacity_load: 1,
    });

    const toewijzing = handle.raw
      .prepare('SELECT user_id, share_bp FROM project_assignments')
      .all() as Array<Record<string, unknown>>;
    expect(toewijzing).toEqual([{ user_id: 1, share_bp: 10000 }]);
  });

  // Dit is de fout die de bezetting stilletjes verdubbelt: twee showroomfasen
  // op hetzelfde project laten de capaciteitsberekening het werk twee keer
  // tellen.
  it('maakt bij een tweede import geen tweede showroomfase aan', () => {
    const bestand = rijen([
      'P26001',
      'Plan Zuidhoek',
      'Nieuwegein',
      32,
      '2026-03-02',
      '2026-05-29',
      'DM',
    ]);

    beoordeel(handle, bestand, OPTIES, 1, true);
    const tweede = beoordeel(handle, bestand, OPTIES, 1, true);

    expect(projecten()).toHaveLength(1);
    expect(fasen()).toHaveLength(1);
    expect(tweede.ongewijzigd).toBe(1);
    expect(tweede.nieuw).toBe(0);
  });

  it('koppelt de begeleider niet twee keer aan hetzelfde project', () => {
    const bestand = rijen([
      'P26001',
      'Plan Zuidhoek',
      'Nieuwegein',
      32,
      '2026-03-02',
      '2026-05-29',
      'DM',
    ]);

    beoordeel(handle, bestand, OPTIES, 1, true);
    beoordeel(handle, bestand, OPTIES, 1, true);

    const toewijzing = handle.raw
      .prepare('SELECT COUNT(*) AS aantal FROM project_assignments')
      .get() as { aantal: number };
    expect(toewijzing.aantal).toBe(1);
  });

  it('werkt een bestaand project bij en schuift de showroomfase mee', () => {
    beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      true,
    );

    const tweede = beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 36, '2026-03-09', '2026-06-05', 'DM']),
      OPTIES,
      1,
      true,
    );

    expect(tweede.bijwerken).toBe(1);
    expect(projecten()[0]).toMatchObject({ unit_count: 36 });
    expect(fasen()).toHaveLength(1);
    expect(fasen()[0]).toMatchObject({ start_date: '2026-03-09', end_date: '2026-06-05' });
  });

  it('noemt bij het bijwerken welke kolommen veranderen', () => {
    beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      true,
    );

    const tweede = beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Houten', 36, '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      false,
    );

    const wijzigingen = tweede.rijen[0]?.wijzigingen ?? [];
    expect(wijzigingen).toEqual(
      expect.arrayContaining([
        { kolom: 'Plaats', van: 'Nieuwegein', naar: 'Houten' },
        { kolom: 'Aantal woningen', van: 32, naar: 36 },
      ]),
    );
  });

  it('laat een bestaand project met rust als bijwerken uit staat', () => {
    beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      true,
    );

    const tweede = beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 99, '2026-03-02', '2026-05-29', 'DM']),
      { ...OPTIES, bestaandeBijwerken: false },
      1,
      true,
    );

    expect(tweede.ongewijzigd).toBe(1);
    expect(projecten()[0]).toMatchObject({ unit_count: 32 });
    expect(tweede.rijen[0]?.meldingen[0]?.ernst).toBe('let_op');
  });

  it('herkent een bestaand project ook op naam als het nummer ontbreekt', () => {
    beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      true,
    );

    const tweede = beoordeel(
      handle,
      rijen([null, 'plan zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      true,
    );

    expect(tweede.nieuw).toBe(0);
    expect(projecten()).toHaveLength(1);
  });
});

describe('meldingen per rij', () => {
  it('weigert een rij zonder projectnaam', () => {
    const beoordeling = beoordeel(
      handle,
      rijen(['P26001', null, 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      true,
    );

    expect(beoordeling.fout).toBe(1);
    expect(projecten()).toHaveLength(0);
    expect(beoordeling.rijen[0]?.meldingen[0]?.tekst).toContain('Projectnaam');
  });

  // Bij een onleesbare waarde stond er wél iets; "ontbreekt" erbij zetten
  // leidt af van de melding die de gebruiker moet lezen.
  it('meldt bij een onleesbare waarde niet ook nog dat het veld ontbreekt', () => {
    const beoordeling = beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 'veel', '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      true,
    );

    const meldingen = beoordeling.rijen[0]?.meldingen ?? [];
    expect(meldingen).toHaveLength(1);
    expect(meldingen[0]?.tekst).toContain('is geen getal');
  });

  it('weigert een einddatum die voor de startdatum ligt', () => {
    const beoordeling = beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-05-29', '2026-03-02', 'DM']),
      OPTIES,
      1,
      true,
    );

    expect(beoordeling.fout).toBe(1);
    expect(beoordeling.rijen[0]?.meldingen[0]?.tekst).toContain('ligt voor de startdatum');
  });

  it('weigert een half huis', () => {
    const beoordeling = beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32.5, '2026-03-02', '2026-05-29', 'DM']),
      OPTIES,
      1,
      true,
    );

    expect(beoordeling.fout).toBe(1);
  });

  it('laat de rest van het bestand gewoon doorgaan als één rij fout is', () => {
    const beoordeling = beoordeel(
      handle,
      rijen(
        ['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM'],
        ['P26002', 'Kapotte regel', 'Houten', 'veel', '2026-06-01', '2026-07-24', 'DM'],
        ['P26003', 'Hovenier', 'Utrecht', 24, '2026-09-07', '2026-11-27', 'DM'],
      ),
      OPTIES,
      1,
      true,
    );

    expect(beoordeling.nieuw).toBe(2);
    expect(beoordeling.fout).toBe(1);
    expect(projecten().map((rij) => rij.name)).toEqual(['Plan Zuidhoek', 'Hovenier']);
  });

  it('waarschuwt bij een onbekende begeleider maar laat het project door', () => {
    const beoordeling = beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'XX']),
      OPTIES,
      1,
      true,
    );

    expect(beoordeling.nieuw).toBe(1);
    expect(beoordeling.rijen[0]?.meldingen[0]).toMatchObject({ ernst: 'let_op' });
    expect(projecten()).toHaveLength(1);
  });

  // Bij een onbekende opdrachtgever wordt bewust geen nieuwe klant aangemaakt:
  // na een paar imports staan er anders vijf varianten van dezelfde aannemer.
  it('maakt geen nieuwe klant aan bij een onbekende opdrachtgever', () => {
    const koppen = [...KOPPEN, 'Opdrachtgever'];
    const beoordeling = beoordeel(
      handle,
      [
        koppen,
        ['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', '2026-05-29', 'DM', 'Onbekend BV'],
      ],
      { ...OPTIES, koppeling: { ...OPTIES.koppeling, opdrachtgever: 7 } },
      1,
      true,
    );

    expect(beoordeling.nieuw).toBe(1);
    const organisaties = handle.raw.prepare('SELECT COUNT(*) AS aantal FROM organizations').get() as {
      aantal: number;
    };
    expect(organisaties.aantal).toBe(1);
    expect(projecten()[0]?.organization_id).toBeNull();
  });

  it('koppelt een opdrachtgever die wel bestaat', () => {
    const koppen = [...KOPPEN, 'Opdrachtgever'];
    beoordeel(
      handle,
      [
        koppen,
        [
          'P26001',
          'Plan Zuidhoek',
          'Nieuwegein',
          32,
          '2026-03-02',
          '2026-05-29',
          'DM',
          'bouwbedrijf meesters b.v.',
        ],
      ],
      { ...OPTIES, koppeling: { ...OPTIES.koppeling, opdrachtgever: 7 } },
      1,
      true,
    );

    expect(projecten()[0]?.organization_id).toBe(1);
  });

  it('waarschuwt als er een startdatum is maar geen einddatum', () => {
    const beoordeling = beoordeel(
      handle,
      rijen(['P26001', 'Plan Zuidhoek', 'Nieuwegein', 32, '2026-03-02', null, 'DM']),
      OPTIES,
      1,
      true,
    );

    expect(beoordeling.nieuw).toBe(1);
    expect(fasen()).toHaveLength(0);
    expect(beoordeling.rijen[0]?.meldingen.map((melding) => melding.ernst)).toContain('let_op');
  });
});
