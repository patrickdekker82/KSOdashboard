/** API-tests voor fase 3: zoeken, dubbelen, samenvoegen, tijdlijn, AVG en bijlagen. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InjectPayload, Response as InjectResponse } from 'light-my-request';
import { openDatabase, type DatabaseHandle } from '../../db/client.ts';
import { applyViews, runMigrations } from '../../db/migrate.ts';
import { DEMO_PASSWORD, seed } from '../../db/seed.ts';
import { buildCore } from '../../server.ts';

const APP_TOKEN = 'test-token-abcdefghijklmnop';

let directory: string;
let handle: DatabaseHandle;
let app: FastifyInstance;
let beheerder: string;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-crm-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);
  applyViews(handle);
  await seed(handle, { referenceDate: new Date('2026-09-07T00:00:00Z'), demo: true });
  app = await buildCore({
    handle,
    appToken: APP_TOKEN,
    mode: 'standalone',
    dataDirectory: directory,
  });
  await app.ready();
  beheerder = await login('patrick@showroom.local');
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

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: headers(),
    payload: { email, password: DEMO_PASSWORD },
  });
  const setCookie = response.headers['set-cookie'];
  return String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
}

type Antwoord = Promise<InjectResponse>;
const get = (url: string, cookie = beheerder): Antwoord =>
  app.inject({ method: 'GET', url, headers: headers(cookie) });
const post = (url: string, payload: InjectPayload, cookie = beheerder): Antwoord =>
  app.inject({ method: 'POST', url, headers: headers(cookie), payload });

const idVan = async (entiteit: string, naam: string): Promise<number> => {
  const rij = handle.raw
    .prepare(`SELECT id FROM ${entiteit} WHERE name = ?`)
    .get(naam) as { id: number };
  return rij.id;
};

// ---------------------------------------------------------------------------

describe('zoeken', () => {
  it('vindt klanten, projecten en kansen in één lijst', async () => {
    const response = await get('/api/v1/search?q=Meesters');
    expect(response.statusCode).toBe(200);
    const treffers = response.json().data.treffers as Array<{ soort: string; titel: string }>;
    expect(treffers.length).toBeGreaterThan(0);
    expect(treffers.map((treffer) => treffer.soort)).toContain('Klant');
  });

  it('vindt een contactpersoon op achternaam', async () => {
    const response = await get('/api/v1/search?q=Vries');
    const treffers = response.json().data.treffers as Array<{ soort: string; titel: string }>;
    expect(treffers.some((treffer) => treffer.soort === 'Contactpersoon')).toBe(true);
  });

  it('zoekt terwijl je typt, op een deel van een woord', async () => {
    const response = await get('/api/v1/search?q=Meest');
    expect((response.json().data.treffers as unknown[]).length).toBeGreaterThan(0);
  });

  it('doet niets bij één letter', async () => {
    const response = await get('/api/v1/search?q=M');
    expect(response.json().data.treffers).toEqual([]);
  });

  it('struikelt niet over tekens die FTS5 als operator leest', async () => {
    // Dit zou zonder opschonen een SQL-fout geven in plaats van nul resultaten.
    for (const term of ['"', '*', 'AND', 'a OR b', 'NEAR(a b)', 'kolom:waarde', '^start', 'a-b']) {
      const response = await get(`/api/v1/search?q=${encodeURIComponent(term)}`);
      expect(response.statusCode, term).toBe(200);
    }
  });
});

describe('dubbelen', () => {
  beforeEach(() => {
    handle.raw
      .prepare(
        "INSERT INTO organizations (name, kvk_number, city) VALUES ('Meesters Bouwbedrijf bv', '99887766', 'Tilburg')",
      )
      .run();
    handle.raw
      .prepare(
        "INSERT INTO organizations (name, kvk_number, city) VALUES ('Bouwbedrijf Meesters', '99887766', 'Tilburg')",
      )
      .run();
  });

  it('vindt het paar en legt uit waarom', async () => {
    const response = await get('/api/v1/duplicates?entity=organizations');
    expect(response.statusCode).toBe(200);
    const { paren, records } = response.json().data;
    expect(paren.length).toBeGreaterThanOrEqual(1);
    expect(paren[0].score).toBe(100);
    expect(paren[0].uitleg).toContain('KvK');
    // De records komen mee, zodat het scherm ze naast elkaar kan zetten.
    expect(records.length).toBeGreaterThanOrEqual(2);
  });

  it('werkt ook op contactpersonen', async () => {
    const response = await get('/api/v1/duplicates?entity=contacts');
    expect(response.statusCode).toBe(200);
  });

  it('weigert een entiteit waar het niet voor bedoeld is', async () => {
    const response = await get('/api/v1/duplicates?entity=projects');
    expect(response.statusCode).toBe(400);
  });
});

describe('samenvoegen', () => {
  it('voegt samen, verhuist alles en archiveert de verliezer', async () => {
    const winnaar = await idVan('organizations', 'Bouwbedrijf Meesters B.V.');
    handle.raw.prepare("INSERT INTO organizations (name, email) VALUES ('Meesters bv', 'oud@meesters.local')").run();
    const verliezer = await idVan('organizations', 'Meesters bv');
    handle.raw
      .prepare("INSERT INTO contacts (organization_id, last_name) VALUES (?, 'Test')")
      .run(verliezer);

    const manager = await login('manager@showroom.local');
    const response = await post(
      `/api/v1/organizations/${winnaar}/merge`,
      { verliezerId: verliezer, waarden: { email: 'oud@meesters.local' } },
      manager,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.verplaatst).toEqual(
      expect.arrayContaining([{ tabel: 'contacts', kolom: 'organization_id', rijen: 1 }]),
    );

    const na = (await get(`/api/v1/organizations/${winnaar}`)).json().data;
    expect(na.email).toBe('oud@meesters.local');

    // De verliezer staat niet meer in de lijst.
    const lijst = (await get('/api/v1/organizations')).json().data as Array<{ id: number }>;
    expect(lijst.some((rij) => rij.id === verliezer)).toBe(false);
  });

  it('vraagt minimaal managerrechten', async () => {
    const gebruiker = await login('dennis@showroom.local');
    const response = await post('/api/v1/organizations/1/merge', { verliezerId: 2 }, gebruiker);
    expect(response.statusCode).toBe(403);
  });

  it('geeft een nette melding bij samenvoegen met zichzelf', async () => {
    const manager = await login('manager@showroom.local');
    const response = await post('/api/v1/organizations/1/merge', { verliezerId: 1 }, manager);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('met zichzelf');
  });
});

describe('tijdlijn en activiteiten', () => {
  it('legt een activiteit vast op een record en toont die op de tijdlijn', async () => {
    const klantId = await idVan('organizations', 'CECI Ontwikkeling');

    const gemaakt = await post(`/api/v1/organizations/${klantId}/activities`, {
      type: 'bellen',
      subject: 'Gebeld over de planning',
      body: 'Sanne belt volgende week terug.',
      completed_at: '2026-09-01 10:00:00',
    });
    expect(gemaakt.statusCode).toBe(201);

    const tijdlijn = (await get(`/api/v1/organizations/${klantId}/timeline`)).json().data as Array<{
      soort: string;
      titel: string;
    }>;
    expect(tijdlijn.some((item) => item.titel.includes('Gebeld over de planning'))).toBe(true);
  });

  it('toont wijzigingen op de tijdlijn, maar alleen zinvolle', async () => {
    const klantId = await idVan('organizations', 'CECI Ontwikkeling');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${klantId}`,
      headers: headers(beheerder),
      payload: { city: 'Etten-Leur' },
    });

    const tijdlijn = (await get(`/api/v1/organizations/${klantId}/timeline`)).json().data as Array<{
      soort: string;
      tekst: string | null;
    }>;
    const wijziging = tijdlijn.find((item) => item.soort === 'wijziging');
    expect(wijziging?.tekst).toContain('city');
    expect(wijziging?.tekst).toContain('Etten-Leur');
  });

  it('weigert een activiteit zonder onderwerp', async () => {
    const response = await post('/api/v1/organizations/1/activities', { type: 'bellen' });
    expect(response.statusCode).toBe(400);
  });
});

describe('tags', () => {
  it('plakt een label op een record en haalt het er weer af', async () => {
    const klantId = await idVan('organizations', 'CECI Ontwikkeling');

    const gezet = await post(`/api/v1/organizations/${klantId}/tags`, { name: 'Belangrijk' });
    expect(gezet.statusCode).toBe(200);
    const tagId = gezet.json().data.id;

    expect((await get(`/api/v1/organizations/${klantId}/tags`)).json().data).toHaveLength(1);

    // Hetzelfde label twee keer plakken levert geen dubbele rij op.
    await post(`/api/v1/organizations/${klantId}/tags`, { name: 'Belangrijk' });
    expect((await get(`/api/v1/organizations/${klantId}/tags`)).json().data).toHaveLength(1);

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/${klantId}/tags/${tagId}`,
      headers: headers(beheerder),
    });
    expect((await get(`/api/v1/organizations/${klantId}/tags`)).json().data).toHaveLength(0);
  });
});

describe('AVG', () => {
  const contactId = (): number =>
    Number((handle.raw.prepare("SELECT id FROM contacts WHERE last_name = 'de Vries'").get() as { id: number } | undefined)?.id ??
      (handle.raw.prepare('SELECT id FROM contacts LIMIT 1').get() as { id: number }).id);

  it('levert een inzagedossier met alles wat er over iemand is vastgelegd', async () => {
    const manager = await login('manager@showroom.local');
    const response = await get(`/api/v1/contacts/${contactId()}/gdpr-export`, manager);
    expect(response.statusCode).toBe(200);
    const dossier = response.json().data;
    expect(dossier.contact).toBeDefined();
    expect(dossier).toHaveProperty('activiteiten');
    expect(dossier).toHaveProperty('emails');
    expect(dossier).toHaveProperty('offertes');
    expect(dossier).toHaveProperty('opgesteldOp');
  });

  it('laat een gewone gebruiker geen dossier opvragen', async () => {
    const gebruiker = await login('dennis@showroom.local');
    const response = await get(`/api/v1/contacts/${contactId()}/gdpr-export`, gebruiker);
    expect(response.statusCode).toBe(403);
  });

  it('anonimiseert pas na de juiste bevestiging', async () => {
    const manager = await login('manager@showroom.local');
    const id = contactId();

    const zonder = await post(`/api/v1/contacts/${id}/anonymise`, {}, manager);
    expect(zonder.statusCode).toBe(400);
    expect(zonder.json().error.message).toContain('ANONIMISEREN');

    const met = await post(`/api/v1/contacts/${id}/anonymise`, { bevestiging: 'ANONIMISEREN' }, manager);
    expect(met.statusCode).toBe(200);

    const rij = handle.raw.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Record<string, unknown>;
    expect(rij.first_name).toBeNull();
    expect(rij.email).toBeNull();
    expect(String(rij.last_name)).toContain('Geanonimiseerd');
    expect(rij.anonymised_at).not.toBeNull();
    // Niet meer benaderen, want daar is geen toestemming meer voor.
    expect(rij.do_not_email).toBe(1);
  });

  it('behoudt de transacties bij het anonimiseren', async () => {
    const manager = await login('manager@showroom.local');
    const id = contactId();
    handle.raw
      .prepare("INSERT INTO package_quotes (contact_id, total_cents, status) VALUES (?, 1200000, 'verstuurd')")
      .run(id);

    const response = await post(`/api/v1/contacts/${id}/anonymise`, { bevestiging: 'ANONIMISEREN' }, manager);
    // Niet op een vast aantal: de demoseed heeft er zelf ook, en dat aantal is
    // geen onderdeel van wat deze test wil aantonen.
    const behouden = response.json().data.behouden as Array<{ wat: string; aantal: number }>;
    const offertes = behouden.find((entry) => entry.wat === 'offertes');
    expect(offertes?.aantal).toBeGreaterThanOrEqual(1);

    // De offerte staat er nog, met bedrag en al.
    const offerte = handle.raw
      .prepare('SELECT total_cents FROM package_quotes WHERE contact_id = ? AND total_cents = 1200000')
      .get(id) as { total_cents: number } | undefined;
    expect(offerte?.total_cents).toBe(1_200_000);
  });

  it('wist ook de oude waarden uit het auditlog', async () => {
    const manager = await login('manager@showroom.local');
    const id = contactId();

    // Een gewone wijziging zet de oude naam in het auditlog.
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/contacts/${id}`,
      headers: headers(beheerder),
      payload: { job_title: 'Directeur' },
    });
    const voor = handle.raw
      .prepare("SELECT before FROM audit_log WHERE entity_key = 'contacts' AND record_id = ? AND before IS NOT NULL")
      .get(id);
    expect(voor).toBeDefined();

    await post(`/api/v1/contacts/${id}/anonymise`, { bevestiging: 'ANONIMISEREN' }, manager);

    // Anders zou de gewiste naam gewoon in de geschiedenis blijven staan.
    const na = handle.raw
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_key = 'contacts' AND record_id = ? AND before IS NOT NULL")
      .get(id) as { n: number };
    expect(na.n).toBe(0);
  });

  it('somt contactpersonen op waar al lang niets mee gebeurd is', async () => {
    const manager = await login('manager@showroom.local');
    const response = await get('/api/v1/gdpr/retention?days=1', manager);
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().data)).toBe(true);
  });
});

describe('bijlagen', () => {
  /** Bouwt een multipart-body met één bestand. */
  function multipart(bestandsnaam: string, inhoud: Buffer): { payload: Buffer; grens: string } {
    const grens = '----showroomtest';
    const kop = Buffer.from(
      `--${grens}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${bestandsnaam}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    );
    const staart = Buffer.from(`\r\n--${grens}--\r\n`);
    return { payload: Buffer.concat([kop, inhoud, staart]), grens };
  }

  async function upload(bestandsnaam: string, inhoud: Buffer): Promise<InjectResponse> {
    const { payload, grens } = multipart(bestandsnaam, inhoud);
    return app.inject({
      method: 'POST',
      url: '/api/v1/organizations/1/attachments',
      headers: {
        ...headers(beheerder),
        'content-type': `multipart/form-data; boundary=${grens}`,
      },
      payload,
    });
  }

  it('accepteert een pdf en geeft hem terug bij het downloaden', async () => {
    const inhoud = Buffer.from('%PDF-1.7 dit is een testbestand');
    const gemaakt = await upload('Offerte 2026.pdf', inhoud);
    expect(gemaakt.statusCode).toBe(201);
    expect(gemaakt.json().data).toMatchObject({
      filename: 'Offerte 2026.pdf',
      mime: 'application/pdf',
      size_bytes: inhoud.byteLength,
    });

    const lijst = (await get('/api/v1/organizations/1/attachments')).json().data;
    expect(lijst).toHaveLength(1);

    const download = await get(`/api/v1/attachments/${gemaakt.json().data.id}/download`);
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['content-disposition']).toContain('attachment;');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.rawPayload.equals(inhoud)).toBe(true);
  });

  it('bewaart het bestand onder een eigen naam, niet die van de gebruiker', async () => {
    const gemaakt = await upload('../../ontsnapping.pdf', Buffer.from('x'));
    expect(gemaakt.statusCode).toBe(201);

    const rij = handle.raw.prepare('SELECT filename, stored_path FROM attachments').get() as {
      filename: string;
      stored_path: string;
    };
    expect(rij.filename).toBe('ontsnapping.pdf'); // getoond, opgeschoond
    expect(rij.stored_path).toMatch(/^\d{4}\/\d{2}\/[0-9a-f]{32}\.pdf$/); // op schijf, gegenereerd
  });

  it('weigert een uitvoerbaar bestand met uitleg', async () => {
    const response = await upload('virus.exe', Buffer.from('MZ'));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('niet geaccepteerd');
  });

  it('vraagt een sessie voor het downloaden', async () => {
    const gemaakt = await upload('offerte.pdf', Buffer.from('x'));
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/attachments/${gemaakt.json().data.id}/download`,
      headers: headers(), // geen cookie
    });
    expect(response.statusCode).toBe(401);
  });

  it('verwijdert een bijlage herstelbaar', async () => {
    const gemaakt = await upload('offerte.pdf', Buffer.from('x'));
    const id = gemaakt.json().data.id;

    const verwijderd = await app.inject({
      method: 'DELETE',
      url: `/api/v1/attachments/${id}`,
      headers: headers(beheerder),
    });
    expect(verwijderd.json()).toEqual({ verwijderd: true, herstelbaar: true });
    expect((await get('/api/v1/organizations/1/attachments')).json().data).toHaveLength(0);
  });
});
