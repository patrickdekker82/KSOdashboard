/**
 * Tests voor de opvolging (hoofdstuk 9).
 *
 * De vier bakjes moeten kloppen rond middernacht — een taak van vandaag hoort
 * niet bij "te laat" — en het afronden moet de vervolgactie aan dezelfde
 * records hangen. Zonder dat laatste staat de vervolgactie nergens in een
 * tijdlijn en is hij de volgende dag onvindbaar.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { runMigrations } from '../../db/migrate.ts';
import { bellijst, markeerBelregel, OpvolgFout, rondAf, werklijst } from './queries.ts';

type Rij = Record<string, unknown>;

let directory: string;
let handle: DatabaseHandle;

const NU = new Date('2026-09-07T09:00:00Z');

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-opvolging-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);

  handle.raw
    .prepare("INSERT INTO users (name, initials, email, password_hash) VALUES ('Patrick', 'PD', 'p@t.local', 'x')")
    .run();
  handle.raw
    .prepare("INSERT INTO users (name, initials, email, password_hash) VALUES ('Dennis', 'DM', 'd@t.local', 'x')")
    .run();
  handle.raw.prepare("INSERT INTO organizations (name) VALUES ('Bouwbedrijf Meesters B.V.')").run();
});

afterEach(() => {
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Maakt een activiteit en koppelt hem aan de klant. */
function taak(onderwerp: string, dueAt: string | null, gebruikerId = 1): number {
  const resultaat = handle.raw
    .prepare(
      `INSERT INTO activities (type, subject, status, due_at, assigned_user_id)
       VALUES ('bellen', ?, 'open', ?, ?)`,
    )
    .run(onderwerp, dueAt, gebruikerId);
  const id = Number(resultaat.lastInsertRowid);

  handle.raw
    .prepare("INSERT INTO activity_links (activity_id, entity_key, record_id) VALUES (?, 'organizations', 1)")
    .run(id);
  return id;
}

describe('de werklijst', () => {
  it('verdeelt taken over te laat, vandaag, komend en zonder datum', () => {
    taak('Gisteren', '2026-09-06 10:00:00');
    taak('Vandaag', '2026-09-07 14:00:00');
    taak('Volgende week', '2026-09-11 09:00:00');
    taak('Ooit', null);

    const lijst = werklijst(handle, 1, NU);

    expect(lijst.teLaat.map((rij) => rij.subject)).toEqual(['Gisteren']);
    expect(lijst.vandaag.map((rij) => rij.subject)).toEqual(['Vandaag']);
    expect(lijst.komend.map((rij) => rij.subject)).toEqual(['Volgende week']);
    expect(lijst.zonderDatum.map((rij) => rij.subject)).toEqual(['Ooit']);
  });

  // Een taak die om 08:00 stond en het nu 09:00 is, staat niet "te laat" maar
  // gewoon vandaag: de dag is nog niet om.
  it('rekent een taak van vandaag niet als te laat, ook al is het tijdstip voorbij', () => {
    taak('Vanochtend vroeg', '2026-09-07 08:00:00');

    const lijst = werklijst(handle, 1, NU);
    expect(lijst.teLaat).toHaveLength(0);
    expect(lijst.vandaag).toHaveLength(1);
  });

  it('kijkt niet verder vooruit dan de horizon', () => {
    taak('Over drie weken', '2026-09-28 09:00:00');
    expect(werklijst(handle, 1, NU, 14).komend).toHaveLength(0);
    expect(werklijst(handle, 1, NU, 30).komend).toHaveLength(1);
  });

  it('toont alleen de taken van de gevraagde gebruiker', () => {
    taak('Van Patrick', '2026-09-07 09:00:00', 1);
    taak('Van Dennis', '2026-09-07 09:00:00', 2);

    expect(werklijst(handle, 1, NU).vandaag).toHaveLength(1);
    expect(werklijst(handle, 2, NU).vandaag.map((rij) => rij.subject)).toEqual(['Van Dennis']);
  });

  it('laat een afgeronde taak weg', () => {
    const id = taak('Al gedaan', '2026-09-06 09:00:00');
    handle.raw
      .prepare("UPDATE activities SET status = 'afgerond', completed_at = '2026-09-06 12:00:00' WHERE id = ?")
      .run(id);

    expect(werklijst(handle, 1, NU).teLaat).toHaveLength(0);
  });

  it('geeft mee waar de taak over gaat, zodat het scherm erheen kan linken', () => {
    taak('Meesters nabellen', '2026-09-07 09:00:00');
    const lijst = werklijst(handle, 1, NU);

    expect(lijst.vandaag[0]).toMatchObject({ entiteit: 'organizations', record_id: 1 });
  });
});

describe('afronden', () => {
  it('sluit de activiteit en legt de uitkomst vast', () => {
    const id = taak('Meesters nabellen', '2026-09-07 09:00:00');
    rondAf(handle, id, { uitkomst: 'Offerte doorgestuurd' }, 1, NU);

    const rij = handle.raw.prepare('SELECT * FROM activities WHERE id = ?').get(id) as Rij;
    expect(rij).toMatchObject({ status: 'afgerond', completed_at: '2026-09-07 09:00:00' });
    expect(rij.body).toBe('Offerte doorgestuurd');
  });

  it('plant meteen een vervolgactie', () => {
    const id = taak('Meesters nabellen', '2026-09-07 09:00:00');
    const uitkomst = rondAf(
      handle,
      id,
      {
        uitkomst: 'Belt over twee weken terug',
        vervolg: { type: 'bellen', subject: 'Meesters opnieuw bellen', dueAt: '2026-09-21 09:00:00' },
      },
      1,
      NU,
    );

    expect(uitkomst.vervolgId).not.toBeNull();
    const vervolg = handle.raw
      .prepare('SELECT * FROM activities WHERE id = ?')
      .get(uitkomst.vervolgId!) as Rij;
    expect(vervolg).toMatchObject({
      subject: 'Meesters opnieuw bellen',
      status: 'open',
      assigned_user_id: 1,
    });
  });

  // Zonder dit staat de vervolgactie nergens in een tijdlijn en is hij de
  // volgende dag onvindbaar.
  it('hangt de vervolgactie aan dezelfde records', () => {
    const id = taak('Meesters nabellen', '2026-09-07 09:00:00');
    const uitkomst = rondAf(
      handle,
      id,
      { vervolg: { type: 'bellen', subject: 'Opnieuw', dueAt: '2026-09-21 09:00:00' } },
      1,
      NU,
    );

    const koppelingen = handle.raw
      .prepare('SELECT * FROM activity_links WHERE activity_id = ?')
      .all(uitkomst.vervolgId!) as Rij[];
    expect(koppelingen).toHaveLength(1);
    expect(koppelingen[0]).toMatchObject({
      activity_id: uitkomst.vervolgId,
      entity_key: 'organizations',
      record_id: 1,
    });
  });

  it('legt de verwijzing naar de vervolgactie vast op de afgeronde taak', () => {
    const id = taak('Meesters nabellen', '2026-09-07 09:00:00');
    const uitkomst = rondAf(
      handle,
      id,
      { vervolg: { type: 'taak', subject: 'Opnieuw', dueAt: '2026-09-21 09:00:00' } },
      1,
      NU,
    );

    const rij = handle.raw.prepare('SELECT next_activity_id FROM activities WHERE id = ?').get(id) as Rij;
    expect(rij.next_activity_id).toBe(uitkomst.vervolgId);
  });

  it('rondt niet twee keer af', () => {
    const id = taak('Meesters nabellen', '2026-09-07 09:00:00');
    rondAf(handle, id, {}, 1, NU);
    expect(() => rondAf(handle, id, {}, 1, NU)).toThrow(/al afgerond/);
  });

  // Een halve afronding is erger dan geen: de taak zou dicht staan zonder dat
  // er een vervolg is ingepland.
  it('laat de taak open als de vervolgactie geen onderwerp heeft', () => {
    const id = taak('Meesters nabellen', '2026-09-07 09:00:00');

    expect(() =>
      rondAf(handle, id, { vervolg: { type: 'bellen', subject: '  ', dueAt: '2026-09-21' } }, 1, NU),
    ).toThrow(OpvolgFout);

    const rij = handle.raw.prepare('SELECT status FROM activities WHERE id = ?').get(id) as Rij;
    expect(rij.status).toBe('open');
  });

  it('meldt een activiteit die niet bestaat', () => {
    expect(() => rondAf(handle, 999, {}, 1, NU)).toThrow(/bestaat niet/);
  });
});

describe('bellijsten', () => {
  beforeEach(() => {
    handle.raw.prepare("INSERT INTO call_lists (name, owner_user_id) VALUES ('Najaarsronde', 1)").run();
    handle.raw
      .prepare("INSERT INTO organizations (name) VALUES ('Woonstichting De Hoventier')")
      .run();
    handle.raw
      .prepare(
        `INSERT INTO call_list_members (call_list_id, entity_key, record_id, sort_order)
         VALUES (1, 'organizations', 1, 0), (1, 'organizations', 2, 1)`,
      )
      .run();
  });

  it('geeft de leden met hun naam terug', () => {
    const regels = bellijst(handle, 1);
    expect(regels.map((regel) => regel.titel)).toEqual([
      'Bouwbedrijf Meesters B.V.',
      'Woonstichting De Hoventier',
    ]);
  });

  it('vinkt een regel af met een notitie', () => {
    markeerBelregel(handle, 1, 'organizations', 1, true, 'Geen interesse dit jaar', NU);

    const regels = bellijst(handle, 1);
    const afgehandeld = regels.find((regel) => regel.record_id === 1)!;
    expect(afgehandeld.afgehandeld).toBe(true);
    expect(afgehandeld.note).toBe('Geen interesse dit jaar');
  });

  // Afgevinkte regels zakken naar beneden in plaats van te verdwijnen: zo is te
  // zien hoever de lijst is en kan een vinkje terug.
  it('zet afgehandelde regels onderaan', () => {
    markeerBelregel(handle, 1, 'organizations', 1, true, null, NU);
    expect(bellijst(handle, 1).map((regel) => regel.record_id)).toEqual([2, 1]);
  });

  it('draait een vinkje terug', () => {
    markeerBelregel(handle, 1, 'organizations', 1, true, null, NU);
    markeerBelregel(handle, 1, 'organizations', 1, false, null, NU);

    expect(bellijst(handle, 1)[0]?.afgehandeld).toBe(false);
  });

  it('meldt een regel die niet op de lijst staat', () => {
    expect(() => markeerBelregel(handle, 1, 'organizations', 99, true, null, NU)).toThrow(
      OpvolgFout,
    );
  });

  it('valt terug op een leesbare aanduiding bij een onbekend soort', () => {
    handle.raw
      .prepare(
        "INSERT INTO call_list_members (call_list_id, entity_key, record_id) VALUES (1, 'iets_anders', 7)",
      )
      .run();

    expect(bellijst(handle, 1).some((regel) => regel.titel === 'iets_anders #7')).toBe(true);
  });
});
