/** API-tests via fastify.inject: happy path, validatie en autorisatie per rol. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type DatabaseHandle } from './db/client.ts';
import { applyViews, migrationFiles, runMigrations } from './db/migrate.ts';
import { DEMO_PASSWORD, seed } from './db/seed.ts';
import { buildCore } from './server.ts';

const APP_TOKEN = 'test-token-abcdefghijklmnop';
const REFERENCE = new Date('2026-09-07T00:00:00Z');

let directory: string;
let handle: DatabaseHandle;
let app: FastifyInstance;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-api-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);
  applyViews(handle);
  await seed(handle, { referenceDate: REFERENCE, demo: true });
  app = await buildCore({ handle, appToken: APP_TOKEN, mode: 'standalone', dataDirectory: directory });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  handle.close();
  rmSync(directory, { recursive: true, force: true });
});

const headers = (cookie?: string): Record<string, string> => ({
  'x-showroom-token': APP_TOKEN,
  ...(cookie ? { cookie } : {}),
});

/** Logs in and returns the session cookie. */
async function login(email = 'patrick@showroom.local'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: headers(),
    payload: { email, password: DEMO_PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
  return raw.split(';')[0]!;
}

describe('toegang tot de kern', () => {
  it('weigert elk verzoek zonder het sessietoken uit preload', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('geen_toegang');
  });

  it('weigert een verkeerd sessietoken', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-showroom-token': 'fout-token-abcdefghijk' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('laat /health door zonder inloggen', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health', headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', mode: 'standalone', ingelogd: false });
    // Niet tegen een vast migratienummer: dat valt om zodra er een migratie
    // bij komt, zonder dat er iets stuk is.
    expect(response.json().schemaVersion).toBe(migrationFiles().at(-1));
  });

  it('vraagt om inloggen bij elk ander adres', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects', headers: headers() });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('niet_ingelogd');
  });

  it('verraadt zonder sessie niet welke adressen bestaan', async () => {
    // Een onbekend adres levert dezelfde 401 als een bestaand adres, zodat je
    // zonder in te loggen de API niet kunt aftasten.
    const response = await app.inject({ method: 'GET', url: '/api/v1/bestaat-niet-echt', headers: headers() });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('niet_ingelogd');
  });

  it('geeft ingelogd een Nederlandse melding bij een onbekend adres', async () => {
    const cookie = await login();
    const onbekendeEntiteit = await app.inject({
      method: 'GET',
      url: '/api/v1/bestaat-niet-echt',
      headers: headers(cookie),
    });
    expect(onbekendeEntiteit.statusCode).toBe(404);
    expect(onbekendeEntiteit.json().error.message).toContain('Onbekende entiteit');

    const onbekendPad = await app.inject({
      method: 'GET',
      url: '/api/v1/een/twee/drie/vier',
      headers: headers(cookie),
    });
    expect(onbekendPad.json().error.message).toBe('Onbekend adres.');
  });
});

describe('inloggen', () => {
  it('logt in met de seedgegevens en zet een httpOnly-cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: headers(),
      payload: { email: 'patrick@showroom.local', password: DEMO_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().gebruiker).toMatchObject({ initials: 'PD', role: 'admin' });
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('geeft dezelfde melding bij een onbekend account en een fout wachtwoord', async () => {
    const onbekend = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: headers(),
      payload: { email: 'niemand@showroom.local', password: DEMO_PASSWORD },
    });
    const foutWachtwoord = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: headers(),
      payload: { email: 'patrick@showroom.local', password: 'FoutWachtwoord1' },
    });
    expect(onbekend.statusCode).toBe(401);
    expect(foutWachtwoord.statusCode).toBe(401);
    expect(onbekend.json().error.message).toBe(foutWachtwoord.json().error.message);
  });

  it('bewaart alleen de hash van het sessietoken in de database', async () => {
    const cookie = await login();
    const token = cookie.split('=')[1]!;
    const row = handle.raw.prepare('SELECT id FROM sessions').get() as { id: string };
    expect(row.id).not.toBe(token);
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('vertelt via /auth/me wie er is ingelogd', async () => {
    const cookie = await login('robert@showroom.local');
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: headers(cookie) });
    expect(response.json().gebruiker).toMatchObject({ initials: 'RB', mustChangePassword: true });
  });

  it('logt uit en maakt de sessie ongeldig', async () => {
    const cookie = await login();
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: headers(cookie) });
    const na = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: headers(cookie) });
    expect(na.statusCode).toBe(401);
  });

  it('weigert een zwak nieuw wachtwoord bij het wijzigen', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: headers(cookie),
      payload: { huidig: DEMO_PASSWORD, nieuw: 'kort' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('wachtwoord_zwak');
  });
});

describe('generieke CRUD', () => {
  it('geeft een gepagineerde lijst met meta', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects?pageSize=2',
      headers: headers(cookie),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
  });

  it('filtert met een base64-filterboom', async () => {
    const cookie = await login();
    const filter = Buffer.from(
      JSON.stringify({ field: 'city', operator: 'eq', value: 'Breda' }),
    ).toString('base64');
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/projects?filter=${encodeURIComponent(filter)}`,
      headers: headers(cookie),
    });
    expect(response.json().data.map((row: { name: string }) => row.name)).toEqual(['Plan CECI']);
  });

  it('weigert een filter op een veld dat niet is vrijgegeven', async () => {
    const cookie = await login();
    const filter = Buffer.from(
      JSON.stringify({ field: 'password_hash', operator: 'eq', value: 'x' }),
    ).toString('base64');
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/users?filter=${encodeURIComponent(filter)}`,
      headers: headers(cookie),
    });
    expect([400, 404]).toContain(response.statusCode);
  });

  it('zoekt met q over de zoekbare kolommen', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations?q=Meesters',
      headers: headers(cookie),
    });
    expect(response.json().data).toHaveLength(1);
  });

  it('maakt, wijzigt, archiveert en herstelt een record', async () => {
    const cookie = await login();

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/disciplines',
      headers: headers(cookie),
      payload: { code: 'NIEUW', name: 'Nieuwe discipline' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/disciplines/${id}`,
      headers: headers(cookie),
      payload: { name: 'Hernoemde discipline' },
    });
    expect(patched.json().data.name).toBe('Hernoemde discipline');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/disciplines/${id}`,
      headers: headers(cookie),
    });
    expect(removed.json()).toEqual({ verwijderd: true, herstelbaar: true });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/disciplines',
      headers: headers(cookie),
    });
    expect(list.json().data.map((row: { id: number }) => row.id)).not.toContain(id);

    const restored = await app.inject({
      method: 'POST',
      url: `/api/v1/disciplines/${id}/restore`,
      headers: headers(cookie),
    });
    expect(restored.json().data.archived_at).toBeNull();
  });

  it('legt elke wijziging vast in het auditlog', async () => {
    const cookie = await login();
    await app.inject({
      method: 'POST',
      url: '/api/v1/disciplines',
      headers: headers(cookie),
      payload: { code: 'AUDIT', name: 'Audittest' },
    });
    const audit = await app.inject({ method: 'GET', url: '/api/v1/audit', headers: headers(cookie) });
    expect(audit.json().data[0]).toMatchObject({ entity_key: 'disciplines', action: 'aangemaakt' });
  });

  it('weigert een onbekend veld bij het opslaan', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/disciplines',
      headers: headers(cookie),
      payload: { code: 'X', name: 'X', stiekem: 'waarde' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('onbekend_veld');
  });

  it('voert een bulkactie uit', async () => {
    const cookie = await login();
    const ids = (
      await app.inject({ method: 'GET', url: '/api/v1/disciplines?pageSize=3', headers: headers(cookie) })
    ).json().data.map((row: { id: number }) => row.id);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/disciplines/bulk',
      headers: headers(cookie),
      payload: { action: 'archive', ids },
    });
    expect(response.json()).toEqual({ gewijzigd: 3 });
  });
});

describe('autorisatie per rol', () => {
  it('laat een readonly-account niets wijzigen', async () => {
    const cookie = await login('acquisitie@showroom.local');
    const lezen = await app.inject({ method: 'GET', url: '/api/v1/projects', headers: headers(cookie) });
    expect(lezen.statusCode).toBe(200);

    const schrijven = await app.inject({
      method: 'POST',
      url: '/api/v1/disciplines',
      headers: headers(cookie),
      payload: { code: 'X', name: 'X' },
    });
    expect(schrijven.statusCode).toBe(403);
    expect(schrijven.json().error.code).toBe('alleen_lezen');
  });

  it('laat een gewone gebruiker geen afwezigheidstypes beheren', async () => {
    const cookie = await login('dennis@showroom.local');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/absence-types',
      headers: headers(cookie),
      payload: { code: 'TEST', name: 'Test' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('geen_rechten');
  });

  it('laat een gewone gebruiker het auditlog niet lezen', async () => {
    const cookie = await login('dennis@showroom.local');
    const response = await app.inject({ method: 'GET', url: '/api/v1/audit', headers: headers(cookie) });
    expect(response.statusCode).toBe(403);
  });

  it('laat alleen een manager of beheerder verlof goedkeuren', async () => {
    const aanvraag = handle.raw
      .prepare(
        `INSERT INTO absences (user_id, absence_type_id, start_date, end_date, status)
         VALUES ((SELECT id FROM users WHERE initials = 'DM'),
                 (SELECT id FROM absence_types WHERE code = 'VERLOF'),
                 '2026-11-02', '2026-11-06', 'aangevraagd')`,
      )
      .run();
    const id = Number(aanvraag.lastInsertRowid);

    const gebruiker = await login('dennis@showroom.local');
    const geweigerd = await app.inject({
      method: 'POST',
      url: `/api/v1/absences/${id}/approve`,
      headers: headers(gebruiker),
    });
    expect(geweigerd.statusCode).toBe(403);

    const manager = await login('manager@showroom.local');
    const toegestaan = await app.inject({
      method: 'POST',
      url: `/api/v1/absences/${id}/approve`,
      headers: headers(manager),
    });
    expect(toegestaan.statusCode).toBe(200);
    expect(toegestaan.json()).toEqual({ id, status: 'goedgekeurd' });
  });
});

describe('verlof en inzet horen bij een persoon', () => {
  /** Het id van een medewerker op zijn initialen. */
  const gebruikerId = (initialen: string): number =>
    Number(
      (handle.raw.prepare('SELECT id FROM users WHERE initials = ?').get(initialen) as { id: number })
        .id,
    );

  const verlofType = (): number =>
    Number(
      (
        handle.raw.prepare("SELECT id FROM absence_types WHERE code = 'VERLOF'").get() as {
          id: number;
        }
      ).id,
    );

  it('vult de medewerker in als de aanvrager die weglaat', async () => {
    const cookie = await login('dennis@showroom.local');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/absences',
      headers: headers(cookie),
      payload: { absence_type_id: verlofType(), start_date: '2026-12-21', end_date: '2026-12-24' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.user_id).toBe(gebruikerId('DM'));
  });

  it('laat een gewone gebruiker geen verlof voor een collega boeken', async () => {
    const cookie = await login('dennis@showroom.local');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/absences',
      headers: headers(cookie),
      payload: {
        user_id: gebruikerId('RB'),
        absence_type_id: verlofType(),
        start_date: '2026-12-21',
        end_date: '2026-12-24',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('alleen_eigen');
  });

  // Dit was het gat: /approve eist de rol manager, maar een gewone POST met
  // status 'goedgekeurd' liep daar zo omheen.
  it('laat een gebruiker zijn eigen aanvraag niet meteen goedkeuren', async () => {
    const cookie = await login('dennis@showroom.local');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/absences',
      headers: headers(cookie),
      payload: {
        absence_type_id: verlofType(),
        start_date: '2026-12-21',
        end_date: '2026-12-24',
        status: 'goedgekeurd',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('status_via_stroom');
  });

  it('laat een gebruiker een bestaande aanvraag ook niet omzetten naar goedgekeurd', async () => {
    const cookie = await login('dennis@showroom.local');
    const aangemaakt = await app.inject({
      method: 'POST',
      url: '/api/v1/absences',
      headers: headers(cookie),
      payload: { absence_type_id: verlofType(), start_date: '2026-12-21', end_date: '2026-12-24' },
    });
    const id = Number(aangemaakt.json().data.id);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/absences/${id}`,
      headers: headers(cookie),
      payload: { status: 'goedgekeurd' },
    });

    expect(response.statusCode).toBe(403);
    const rij = handle.raw.prepare('SELECT status FROM absences WHERE id = ?').get(id) as {
      status: string;
    };
    expect(rij.status).toBe('aangevraagd');
  });

  it('laat een gebruiker de aanvraag van een collega niet wijzigen', async () => {
    const vanRobert = handle.raw
      .prepare(
        `INSERT INTO absences (user_id, absence_type_id, start_date, end_date, status)
         VALUES (?, ?, '2026-11-02', '2026-11-06', 'aangevraagd')`,
      )
      .run(gebruikerId('RB'), verlofType());
    const id = Number(vanRobert.lastInsertRowid);

    const cookie = await login('dennis@showroom.local');
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/absences/${id}`,
      headers: headers(cookie),
      payload: { note: 'toch maar niet' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('alleen_eigen');
  });

  it('laat een gebruiker de aanvraag van een collega niet verwijderen', async () => {
    const vanRobert = handle.raw
      .prepare(
        `INSERT INTO absences (user_id, absence_type_id, start_date, end_date, status)
         VALUES (?, ?, '2026-11-02', '2026-11-06', 'aangevraagd')`,
      )
      .run(gebruikerId('RB'), verlofType());
    const id = Number(vanRobert.lastInsertRowid);

    const cookie = await login('dennis@showroom.local');
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/absences/${id}`,
      headers: headers(cookie),
    });

    expect(response.statusCode).toBe(403);
  });

  // Een bulk die halverwege op een record van een collega stuit, mag de eerste
  // helft niet al hebben doorgevoerd.
  it('voert een bulkactie niet half uit als er een collega tussen zit', async () => {
    const cookie = await login('dennis@showroom.local');
    const eigen = await app.inject({
      method: 'POST',
      url: '/api/v1/absences',
      headers: headers(cookie),
      payload: { absence_type_id: verlofType(), start_date: '2026-12-21', end_date: '2026-12-24' },
    });
    const eigenId = Number(eigen.json().data.id);

    const vanRobert = handle.raw
      .prepare(
        `INSERT INTO absences (user_id, absence_type_id, start_date, end_date, status)
         VALUES (?, ?, '2026-11-02', '2026-11-06', 'aangevraagd')`,
      )
      .run(gebruikerId('RB'), verlofType());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/absences/bulk',
      headers: headers(cookie),
      payload: { action: 'archive', ids: [eigenId, Number(vanRobert.lastInsertRowid)] },
    });

    expect(response.statusCode).toBe(403);
    const rij = handle.raw.prepare('SELECT archived_at FROM absences WHERE id = ?').get(eigenId) as {
      archived_at: string | null;
    };
    expect(rij.archived_at).toBeNull();
  });

  it('laat een manager wel voor een collega plannen', async () => {
    const cookie = await login('manager@showroom.local');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/absences',
      headers: headers(cookie),
      payload: {
        user_id: gebruikerId('RB'),
        absence_type_id: verlofType(),
        start_date: '2026-12-21',
        end_date: '2026-12-24',
        status: 'goedgekeurd',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.status).toBe('goedgekeurd');
  });

  it('geldt dezelfde regel voor inzet elders', async () => {
    const cookie = await login('dennis@showroom.local');
    const type = handle.raw.prepare('SELECT id FROM allocation_types LIMIT 1').get() as { id: number };

    const eigen = await app.inject({
      method: 'POST',
      url: '/api/v1/capacity-allocations',
      headers: headers(cookie),
      payload: {
        allocation_type_id: type.id,
        title: 'Meewerken aan de nieuwbouwshowroom',
        start_date: '2026-10-05',
        end_date: '2026-10-16',
        allocation_mode: 'percentage',
        allocation_value: 40,
      },
    });
    expect(eigen.statusCode).toBe(201);
    expect(eigen.json().data.user_id).toBe(gebruikerId('DM'));

    const vanCollega = await app.inject({
      method: 'POST',
      url: '/api/v1/capacity-allocations',
      headers: headers(cookie),
      payload: {
        user_id: gebruikerId('RB'),
        allocation_type_id: type.id,
        title: 'Voor een ander plannen',
        start_date: '2026-10-05',
        end_date: '2026-10-16',
        allocation_mode: 'percentage',
        allocation_value: 40,
      },
    });
    expect(vanCollega.statusCode).toBe(403);
  });
});

describe('capaciteit en beschikbaarheid', () => {
  it('levert een weekreeks met belasting, capaciteit en status', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/capacity/weekly?from=2026-W37&to=2026-W50',
      headers: headers(cookie),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(14);
    expect(body.data[0]).toHaveProperty('capacityIfFullyStaffed');
    expect(body.data[0]).toHaveProperty('byUser');
    expect(body.meta.instellingen.capacityMode).toBe('laagste_van_beide');
  });

  it('geeft een nette fout bij een onmogelijke week', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/capacity/weekly?from=2026-W99',
      headers: headers(cookie),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('ongeldige_week');
  });

  it('vindt capaciteitsgaten met een acquisitiebehoefte', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/capacity/gaps?from=2026-W37&to=2027-W20',
      headers: headers(cookie),
    });
    expect(response.statusCode).toBe(200);
    const gaps = response.json().data;
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    expect(gaps[0]).toHaveProperty('shortfallUnits');
  });

  it('simuleert een scenario zonder iets op te slaan', async () => {
    const cookie = await login();
    const voor = await app.inject({
      method: 'GET',
      url: '/api/v1/capacity/weekly?from=2026-W40&to=2026-W44',
      headers: headers(cookie),
    });
    const scenario = await app.inject({
      method: 'POST',
      url: '/api/v1/capacity/simulate',
      headers: headers(cookie),
      payload: { from: '2026-W40', to: '2026-W44', V: 2 },
    });
    expect(scenario.statusCode).toBe(200);
    // Twee afspraken per woning verdubbelt de belasting.
    const belastingVoor = voor.json().data.reduce((sum: number, w: { loadTotal: number }) => sum + w.loadTotal, 0);
    const belastingNa = scenario.json().data.reduce((sum: number, w: { loadTotal: number }) => sum + w.loadTotal, 0);
    expect(belastingNa).toBeGreaterThan(belastingVoor);

    // En de instellingen in de database zijn niet aangeraakt.
    const settings = await app.inject({ method: 'GET', url: '/api/v1/settings', headers: headers(cookie) });
    expect(settings.json().data.appointments_per_unit).toBe(1);
  });

  it('geeft beschikbaarheid per medewerker per week', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/availability/weekly?from=2026-W39&to=2026-W40',
      headers: headers(cookie),
    });
    const eerste = response.json().data[0];
    expect(eerste.gebruikers).toHaveLength(3); // alleen kopersbegeleiders
    const rb = eerste.gebruikers.find((user: { initials: string }) => user.initials === 'RB');
    expect(rb.baseHours).toBe(32);
    expect(rb.leaveHours).toBe(32); // RB heeft die week verlof
    expect(rb.capacity).toBe(0);
  });

  it('toont wat een verlofaanvraag met de bezetting doet', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/absences/conflicts?userId=1&start=2026-10-05&end=2026-10-09',
      headers: headers(cookie),
    });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.blokkeert).toBe(false); // waarschuwen, niet blokkeren
    expect(data.weken[0]).toHaveProperty('bezettingVoor');
    expect(data.weken[0]).toHaveProperty('bezettingNa');
    expect(data.weken[0].capaciteitNa).toBeLessThanOrEqual(data.weken[0].capaciteitVoor);
  });

  it('levert de verlofkalender met afwezigheid, inzet en de capaciteitsstrook', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/availability/calendar?from=2026-W37&to=2026-W45',
      headers: headers(cookie),
    });
    const data = response.json().data;
    expect(data.afwezigheid.length).toBeGreaterThan(0);
    expect(data.inzet.length).toBeGreaterThan(0);
    expect(data.weken.length).toBe(9);
  });
});

describe('verlofsaldo', () => {
  it('geeft per medewerker recht, opgenomen en wat er nog vrij te plannen is', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/leave-balances/overview?year=${REFERENCE.getUTCFullYear()}`,
      headers: headers(cookie),
    });

    expect(response.statusCode).toBe(200);
    const saldi = response.json().data as Array<Record<string, number | string | boolean>>;

    const robert = saldi.find((saldo) => saldo.initials === 'RB')!;
    expect(robert.rechtUren).toBe(160); // vier dagen van acht uur, 25 dagen recht
    expect(robert.overgeheveldUren).toBe(8);
    // Twee weken vakantie op een vierdaags rooster is acht werkdagen.
    expect(robert.opgenomenUren).toBe(64);
    expect(robert.resterendUren).toBe(104);
    expect(robert.rechtVastgelegd).toBe(true);

    // De ziekmelding van RB gaat niet van zijn verlof af.
    const dennis = saldi.find((saldo) => saldo.initials === 'DM')!;
    expect(dennis.opgenomenUren).toBe(24); // drie losse verlofdagen

    // Wie geen recht heeft vastgelegd, staat er ook bij — juist dat wil een
    // manager zien.
    const acquisitie = saldi.find((saldo) => saldo.initials === 'MA')!;
    expect(acquisitie.rechtVastgelegd).toBe(false);
  });

  it('weigert een onzinnig jaartal', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/leave-balances/overview?year=12',
      headers: headers(cookie),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('ongeldig_jaar');
  });
});

describe('signaleringen', () => {
  /** Draait de controle en geeft de meldingen terug. */
  async function controleer(cookie: string): Promise<Array<Record<string, unknown>>> {
    const run = await app.inject({
      method: 'POST',
      url: '/api/v1/alerts/run',
      headers: headers(cookie),
      payload: {},
    });
    expect(run.statusCode).toBe(200);

    const lijst = await app.inject({ method: 'GET', url: '/api/v1/alerts', headers: headers(cookie) });
    return lijst.json().data as Array<Record<string, unknown>>;
  }

  it('rekent de regels door en levert meldingen op', async () => {
    const cookie = await login();
    const meldingen = await controleer(cookie);

    expect(meldingen.length).toBeGreaterThan(0);
    // De ernstigste bovenaan: daar begint iemand met lezen.
    expect(meldingen[0]?.severity).toBe('urgent');
  });

  it('laat een gewone gebruiker de controle niet starten', async () => {
    const cookie = await login('dennis@showroom.local');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/alerts/run',
      headers: headers(cookie),
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });

  it('telt de meldingen per ernst voor de kopbalk', async () => {
    const cookie = await login();
    await controleer(cookie);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts/count',
      headers: headers(cookie),
    });
    const telling = response.json().data as { urgent: number; let_op: number; info: number };
    expect(telling.urgent + telling.let_op + telling.info).toBeGreaterThan(0);
  });

  it('bevestigt een melding', async () => {
    const cookie = await login();
    const meldingen = await controleer(cookie);
    const id = Number(meldingen[0]?.id);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/alerts/${id}/acknowledge`,
      headers: headers(cookie),
    });

    expect(response.statusCode).toBe(200);
    const rij = handle.raw.prepare('SELECT status, acknowledged_by FROM alerts WHERE id = ?').get(id) as {
      status: string;
      acknowledged_by: number | null;
    };
    expect(rij).toMatchObject({ status: 'bevestigd' });
    expect(rij.acknowledged_by).not.toBeNull();
  });

  // Uitstellen haalt de melding uit beeld maar niet uit de database: staat de
  // situatie er dan nog, dan komt hij vanzelf terug.
  it('stelt een melding uit en verbergt hem tot die datum', async () => {
    const cookie = await login();
    const meldingen = await controleer(cookie);
    const id = Number(meldingen[0]?.id);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/alerts/${id}/snooze`,
      headers: headers(cookie),
      payload: { dagen: 14 },
    });
    expect(response.statusCode).toBe(200);

    const daarna = await app.inject({ method: 'GET', url: '/api/v1/alerts', headers: headers(cookie) });
    const zichtbaar = daarna.json().data as Array<Record<string, unknown>>;
    expect(zichtbaar.some((melding) => Number(melding.id) === id)).toBe(false);

    const meeUitgesteld = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts?includeSnoozed=true',
      headers: headers(cookie),
    });
    const alles = meeUitgesteld.json().data as Array<Record<string, unknown>>;
    expect(alles.some((melding) => Number(melding.id) === id)).toBe(true);
  });

  it('weigert een onzinnige uitsteltermijn', async () => {
    const cookie = await login();
    const meldingen = await controleer(cookie);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/alerts/${Number(meldingen[0]?.id)}/snooze`,
      headers: headers(cookie),
      payload: { dagen: 5000 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('sluit een melding handmatig', async () => {
    const cookie = await login();
    const meldingen = await controleer(cookie);
    const id = Number(meldingen[0]?.id);

    await app.inject({
      method: 'POST',
      url: `/api/v1/alerts/${id}/resolve`,
      headers: headers(cookie),
    });

    const rij = handle.raw.prepare('SELECT status FROM alerts WHERE id = ?').get(id) as {
      status: string;
    };
    expect(rij.status).toBe('opgelost');
  });

  it('meldt dat een melding al is afgehandeld', async () => {
    const cookie = await login();
    const meldingen = await controleer(cookie);
    const id = Number(meldingen[0]?.id);

    await app.inject({ method: 'POST', url: `/api/v1/alerts/${id}/resolve`, headers: headers(cookie) });
    const nogmaals = await app.inject({
      method: 'POST',
      url: `/api/v1/alerts/${id}/resolve`,
      headers: headers(cookie),
    });

    expect(nogmaals.statusCode).toBe(404);
  });

  it('filtert op ernst', async () => {
    const cookie = await login();
    await controleer(cookie);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts?severity=urgent',
      headers: headers(cookie),
    });
    const meldingen = response.json().data as Array<Record<string, unknown>>;
    expect(meldingen.every((melding) => melding.severity === 'urgent')).toBe(true);
  });

  // Een regeltype zonder code hoort zichtbaar te zijn, niet stil nooit af te gaan.
  it('laat per regel zien of hij al gebouwd is', async () => {
    const cookie = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts/rules',
      headers: headers(cookie),
    });

    const regels = response.json().data as Array<Record<string, unknown>>;
    expect(regels).toHaveLength(18);
    const backup = regels.find((regel) => regel.type === 'backup_failed');
    expect(backup?.gebouwd).toBe(false);
    expect(regels.filter((regel) => regel.gebouwd === true)).toHaveLength(17);
  });
});

describe('privacy rond ziekteverzuim', () => {
  it('toont collega’s alleen "Afwezig" bij een ziekmelding', async () => {
    const cookie = await login('dennis@showroom.local'); // DM, gewone gebruiker
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/availability/calendar?from=2026-W36&to=2026-W40',
      headers: headers(cookie),
    });
    const ziek = response
      .json()
      .data.afwezigheid.filter((row: { user_name: string; type_name: string }) =>
        row.user_name.includes('Robert'),
      );
    expect(ziek.length).toBeGreaterThan(0);
    expect(ziek.some((row: { type_name: string }) => row.type_name === 'Ziekte')).toBe(false);
    expect(ziek.some((row: { type_name: string }) => row.type_name === 'Afwezig')).toBe(true);
  });

  it('toont de manager wel het werkelijke type', async () => {
    const cookie = await login('manager@showroom.local');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/availability/calendar?from=2026-W36&to=2026-W40',
      headers: headers(cookie),
    });
    const types = response.json().data.afwezigheid.map((row: { type_name: string }) => row.type_name);
    expect(types).toContain('Ziekte');
  });

  it('toont de betrokkene zelf wel het werkelijke type', async () => {
    const cookie = await login('robert@showroom.local');
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/availability/calendar?from=2026-W36&to=2026-W40',
      headers: headers(cookie),
    });
    const types = response.json().data.afwezigheid.map((row: { type_name: string }) => row.type_name);
    expect(types).toContain('Ziekte');
  });
});

describe('feestdagen genereren', () => {
  it('vraagt beheerdersrechten', async () => {
    const cookie = await login('dennis@showroom.local');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/holidays/generate',
      headers: headers(cookie),
      payload: { year: 2028 },
    });
    expect(response.statusCode).toBe(403);
  });

  it('genereert een jaar en laat bestaande feestdagen ongemoeid', async () => {
    const cookie = await login();
    const eerste = await app.inject({
      method: 'POST',
      url: '/api/v1/holidays/generate',
      headers: headers(cookie),
      payload: { year: 2028 },
    });
    expect(eerste.json()).toMatchObject({ jaar: 2028, toegevoegd: 11, totaal: 11 });

    const tweede = await app.inject({
      method: 'POST',
      url: '/api/v1/holidays/generate',
      headers: headers(cookie),
      payload: { year: 2028 },
    });
    expect(tweede.json().toegevoegd).toBe(0);
  });
});
