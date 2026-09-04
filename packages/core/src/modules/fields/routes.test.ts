/**
 * De acceptatietest van hoofdstuk 15, punt 2:
 *
 *   "Een beheerder kan zonder code een veld toevoegen, hernoemen, verplaatsen,
 *    verbergen en verwijderen; dat veld werkt direct in formulier, lijst,
 *    filter, export en query."
 *
 * Deze test loopt dat scenario van begin tot eind door de echte API.
 */
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
  directory = mkdtempSync(join(tmpdir(), 'showroom-fields-'));
  handle = openDatabase(join(directory, 'showroom.db'));
  runMigrations(handle);
  applyViews(handle);
  await seed(handle, { referenceDate: new Date('2026-09-07T00:00:00Z'), demo: true });
  app = await buildCore({ handle, appToken: APP_TOKEN, mode: 'standalone', dataDirectory: directory });
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
const patch = (url: string, payload: InjectPayload, cookie = beheerder): Antwoord =>
  app.inject({ method: 'PATCH', url, headers: headers(cookie), payload });
const del = (url: string, cookie = beheerder): Antwoord =>
  app.inject({ method: 'DELETE', url, headers: headers(cookie) });

const filterVoor = (filter: unknown) =>
  encodeURIComponent(Buffer.from(JSON.stringify(filter)).toString('base64'));

// ---------------------------------------------------------------------------

describe('het register vullen', () => {
  it('kent de systeemvelden en secties van een entiteit', async () => {
    const response = await get('/api/v1/fields?entity=projects');
    expect(response.statusCode).toBe(200);
    const { velden, secties } = response.json().data;
    expect(velden.length).toBeGreaterThan(10);
    expect(secties.map((sectie: { name: string }) => sectie.name)).toEqual([
      'Project',
      'Showroom',
      'Financieel',
    ]);
    expect(velden.find((veld: { fieldKey: string }) => veld.fieldKey === 'name')).toMatchObject({
      label: 'Naam',
      storage: 'column',
      isLocked: true,
    });
  });

  it('somt de beschikbare veldtypes op', async () => {
    const response = await get('/api/v1/field-types');
    const data = response.json().data;
    expect(data.types).toHaveLength(21);
    expect(data.types.map((type: { type: string }) => type.type)).toContain('formula');
    expect(data.functies).toContain('ALS');
  });

  it('stelt een nette sleutel voor bij een label', async () => {
    const response = await post('/api/v1/fields/suggest-key', { label: 'Bouwstroom fase 2' });
    expect(response.json().data.field_key).toBe('cf_bouwstroom_fase_2');
  });
});

describe('een veld toevoegen zonder code', () => {
  it('maakt het veld aan en het werkt meteen in formulier, lijst en filter', async () => {
    // 1. Toevoegen.
    const gemaakt = await post('/api/v1/fields', {
      entity_key: 'projects',
      label: 'Bouwstroom',
      type: 'select',
      options_source: 'static',
      validation: {
        options: [
          { value: 'A', label: 'Stroom A' },
          { value: 'B', label: 'Stroom B' },
        ],
      },
    });
    expect(gemaakt.statusCode).toBe(201);
    expect(gemaakt.json().data).toMatchObject({
      fieldKey: 'cf_bouwstroom',
      storage: 'json',
      isSystem: false,
    });

    // 2. Het staat in het schema dat het formulier ophaalt.
    const schema = await get('/api/v1/projects/schema');
    expect(
      schema.json().data.velden.some((veld: { field_key: string }) => veld.field_key === 'cf_bouwstroom'),
    ).toBe(true);

    // 3. Opslaan op een record.
    const projecten = (await get('/api/v1/projects')).json().data;
    const projectId = projecten[0].id;
    const opgeslagen = await patch(`/api/v1/projects/${projectId}`, {
      custom_fields: { cf_bouwstroom: 'A' },
    });
    expect(opgeslagen.statusCode).toBe(200);
    expect(opgeslagen.json().data.custom_fields).toEqual({ cf_bouwstroom: 'A' });

    // 4. Het komt terug in de lijst.
    const lijst = await get('/api/v1/projects');
    const rij = lijst.json().data.find((project: { id: number }) => project.id === projectId);
    expect(rij.custom_fields.cf_bouwstroom).toBe('A');

    // 5. Er kan op gefilterd worden.
    const gefilterd = await get(
      `/api/v1/projects?filter=${filterVoor({ field: 'cf_bouwstroom', operator: 'eq', value: 'A' })}`,
    );
    expect(gefilterd.json().data).toHaveLength(1);
    expect(gefilterd.json().data[0].id).toBe(projectId);

    // 6. En er kan op gesorteerd worden.
    const gesorteerd = await get('/api/v1/projects?sort=-cf_bouwstroom');
    expect(gesorteerd.statusCode).toBe(200);
  });

  it('dwingt de keuzelijst af bij het opslaan', async () => {
    await post('/api/v1/fields', {
      entity_key: 'projects',
      label: 'Bouwstroom',
      type: 'select',
      options_source: 'static',
      validation: { options: [{ value: 'A', label: 'A' }] },
    });
    const projectId = (await get('/api/v1/projects')).json().data[0].id;

    const fout = await patch(`/api/v1/projects/${projectId}`, {
      custom_fields: { cf_bouwstroom: 'Z' },
    });
    expect(fout.statusCode).toBe(400);
    expect(fout.json().error.message).toContain('niet (meer) in de lijst');
  });

  it('dwingt verplicht en type af', async () => {
    await post('/api/v1/fields', {
      entity_key: 'projects',
      label: 'Aantal parkeerplaatsen',
      type: 'integer',
      required: true,
      validation: { min: 0 },
    });
    const projectId = (await get('/api/v1/projects')).json().data[0].id;

    const geenGetal = await patch(`/api/v1/projects/${projectId}`, {
      custom_fields: { cf_aantal_parkeerplaatsen: 'veel' },
    });
    expect(geenGetal.statusCode).toBe(400);

    const negatief = await patch(`/api/v1/projects/${projectId}`, {
      custom_fields: { cf_aantal_parkeerplaatsen: -1 },
    });
    expect(negatief.statusCode).toBe(400);

    const goed = await patch(`/api/v1/projects/${projectId}`, {
      custom_fields: { cf_aantal_parkeerplaatsen: 12 },
    });
    expect(goed.statusCode).toBe(200);
    expect(goed.json().data.custom_fields.cf_aantal_parkeerplaatsen).toBe(12);
  });

  it('weigert een sleutel die al bestaat', async () => {
    const payload = { entity_key: 'projects', label: 'Bouwstroom', type: 'text' };
    expect((await post('/api/v1/fields', payload)).statusCode).toBe(201);
    const tweede = await post('/api/v1/fields', payload);
    expect(tweede.statusCode).toBe(409);
  });

  it('weigert een onbekend veldtype', async () => {
    const response = await post('/api/v1/fields', {
      entity_key: 'projects',
      label: 'Raar',
      type: 'onzin',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('onbekend_type');
  });

  it('laat alleen een beheerder velden toevoegen', async () => {
    const gebruiker = await login('dennis@showroom.local');
    const response = await post(
      '/api/v1/fields',
      { entity_key: 'projects', label: 'Stiekem', type: 'text' },
      gebruiker,
    );
    expect(response.statusCode).toBe(403);
  });
});

describe('een veld hernoemen en verplaatsen', () => {
  it('hernoemt zonder de opgeslagen data te raken', async () => {
    const veld = (
      await post('/api/v1/fields', { entity_key: 'projects', label: 'Bouwstroom', type: 'text' })
    ).json().data;
    const projectId = (await get('/api/v1/projects')).json().data[0].id;
    await patch(`/api/v1/projects/${projectId}`, { custom_fields: { cf_bouwstroom: 'A' } });

    const hernoemd = await patch(`/api/v1/fields/${veld.id}`, { label: 'Bouwstroomnummer' });
    expect(hernoemd.json().data.label).toBe('Bouwstroomnummer');

    // De sleutel en dus de data blijven ongemoeid.
    expect(hernoemd.json().data.fieldKey).toBe('cf_bouwstroom');
    const record = await get(`/api/v1/projects/${projectId}`);
    expect(record.json().data.custom_fields.cf_bouwstroom).toBe('A');
  });

  it('weigert het wijzigen van de sleutel of het type van een bestaand veld', async () => {
    const veld = (
      await post('/api/v1/fields', { entity_key: 'projects', label: 'Bouwstroom', type: 'text' })
    ).json().data;

    const sleutel = await patch(`/api/v1/fields/${veld.id}`, { field_key: 'cf_anders' });
    expect(sleutel.statusCode).toBe(400);
    const type = await patch(`/api/v1/fields/${veld.id}`, { type: 'number' });
    expect(type.statusCode).toBe(400);
  });

  it('verplaatst velden naar een andere sectie en volgorde', async () => {
    const { velden, secties } = (await get('/api/v1/fields?entity=projects')).json().data;
    const eerste = velden[0];
    const doelSectie = secties[2].id;

    const response = await post('/api/v1/fields/reorder', {
      entity_key: 'projects',
      volgorde: [{ id: eerste.id, section_id: doelSectie, sort_order: 99 }],
    });
    expect(response.statusCode).toBe(200);

    const na = response.json().data.find((veld: { id: number }) => veld.id === eerste.id);
    expect(na.sectionId).toBe(doelSectie);
    expect(na.sortOrder).toBe(99);
  });

  it('beschermt een vergrendeld veld', async () => {
    const velden = (await get('/api/v1/fields?entity=projects')).json().data.velden;
    const naam = velden.find((veld: { fieldKey: string }) => veld.fieldKey === 'name');
    expect(naam.isLocked).toBe(true);

    const hernoemen = await patch(`/api/v1/fields/${naam.id}`, { label: 'Iets anders' });
    expect(hernoemen.statusCode).toBe(400);
    expect(hernoemen.json().error.code).toBe('veld_vergrendeld');

    const verbergen = await del(`/api/v1/fields/${naam.id}`);
    expect(verbergen.statusCode).toBe(400);
  });
});

describe('verbergen en verwijderen', () => {
  it('verbergt een systeemveld in plaats van het te verwijderen', async () => {
    const velden = (await get('/api/v1/fields?entity=projects')).json().data.velden;
    const plaats = velden.find((veld: { fieldKey: string }) => veld.fieldKey === 'city');

    const response = await del(`/api/v1/fields/${plaats.id}`);
    expect(response.json()).toMatchObject({ verborgen: true, verwijderd: false });
    expect(response.json().melding).toContain('systeemveld');

    const na = (await get(`/api/v1/fields/${plaats.id}`)).json().data;
    expect(na.visibleInList).toBe(false);
    expect(na.visibleInDetail).toBe(false);
  });

  it('weigert een systeemveld definitief te verwijderen', async () => {
    const velden = (await get('/api/v1/fields?entity=projects')).json().data.velden;
    const plaats = velden.find((veld: { fieldKey: string }) => veld.fieldKey === 'city');
    const response = await post(`/api/v1/fields/${plaats.id}/purge`, { bevestiging: 'city' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('systeemveld');
  });

  it('archiveert een maatwerkveld: weg uit de schermen, data blijft', async () => {
    const veld = (
      await post('/api/v1/fields', { entity_key: 'projects', label: 'Bouwstroom', type: 'text' })
    ).json().data;
    const projectId = (await get('/api/v1/projects')).json().data[0].id;
    await patch(`/api/v1/projects/${projectId}`, { custom_fields: { cf_bouwstroom: 'A' } });

    const gearchiveerd = await del(`/api/v1/fields/${veld.id}`);
    expect(gearchiveerd.json()).toMatchObject({ gearchiveerd: true, verwijderd: false });

    // Uit het register verdwenen...
    const register = (await get('/api/v1/fields?entity=projects')).json().data.velden;
    expect(register.some((entry: { id: number }) => entry.id === veld.id)).toBe(false);

    // ...maar de data staat er nog, en is terug te halen.
    const hersteld = await post(`/api/v1/fields/${veld.id}/restore`, {});
    expect(hersteld.statusCode).toBe(200);
    const record = await get(`/api/v1/projects/${projectId}`);
    expect(record.json().data.custom_fields.cf_bouwstroom).toBe('A');
  });

  it('verwijdert een maatwerkveld definitief, maar alleen na de juiste bevestiging', async () => {
    const veld = (
      await post('/api/v1/fields', { entity_key: 'projects', label: 'Bouwstroom', type: 'text' })
    ).json().data;
    const projecten = (await get('/api/v1/projects')).json().data;
    await patch(`/api/v1/projects/${projecten[0].id}`, { custom_fields: { cf_bouwstroom: 'A' } });
    await patch(`/api/v1/projects/${projecten[1].id}`, { custom_fields: { cf_bouwstroom: 'B' } });

    // Zonder de juiste bevestiging gebeurt er niets.
    const zonder = await post(`/api/v1/fields/${veld.id}/purge`, {});
    expect(zonder.statusCode).toBe(400);
    expect(zonder.json().error.message).toContain('cf_bouwstroom');

    const verkeerd = await post(`/api/v1/fields/${veld.id}/purge`, { bevestiging: 'bouwstroom' });
    expect(verkeerd.statusCode).toBe(400);

    // Met de juiste bevestiging verdwijnt het veld en de data in alle rijen.
    const goed = await post(`/api/v1/fields/${veld.id}/purge`, { bevestiging: 'cf_bouwstroom' });
    expect(goed.json()).toMatchObject({ verwijderd: true, rijen: 2 });

    expect((await get(`/api/v1/fields/${veld.id}`)).statusCode).toBe(404);
    const record = await get(`/api/v1/projects/${projecten[0].id}`);
    expect(record.json().data.custom_fields).toEqual({});
  });

  it('legt een definitieve verwijdering vast in het auditlog', async () => {
    const veld = (
      await post('/api/v1/fields', { entity_key: 'projects', label: 'Bouwstroom', type: 'text' })
    ).json().data;
    await post(`/api/v1/fields/${veld.id}/purge`, { bevestiging: 'cf_bouwstroom' });

    const audit = (await get('/api/v1/audit')).json().data;
    expect(audit[0]).toMatchObject({
      entity_key: 'field_definitions',
      action: 'definitief_verwijderd',
    });
  });
});

describe('een geïndexeerd veld', () => {
  it('legt een gegenereerde kolom en index aan, en gebruikt die in het filter', async () => {
    await post('/api/v1/fields', {
      entity_key: 'projects',
      label: 'Bouwstroom',
      type: 'text',
      indexed: true,
    });

    const kolommen = (
      handle.raw.prepare('PRAGMA table_xinfo(projects)').all() as Array<{ name: string }>
    ).map((rij) => rij.name);
    expect(kolommen).toContain('cf_bouwstroom_idx');

    const projectId = (await get('/api/v1/projects')).json().data[0].id;
    await patch(`/api/v1/projects/${projectId}`, { custom_fields: { cf_bouwstroom: 'A' } });

    const gefilterd = await get(
      `/api/v1/projects?filter=${filterVoor({ field: 'cf_bouwstroom', operator: 'eq', value: 'A' })}`,
    );
    expect(gefilterd.json().data).toHaveLength(1);
  });

  it('haalt de index weer weg als de beheerder hem uitzet', async () => {
    const veld = (
      await post('/api/v1/fields', {
        entity_key: 'projects',
        label: 'Bouwstroom',
        type: 'text',
        indexed: true,
      })
    ).json().data;

    await patch(`/api/v1/fields/${veld.id}`, { indexed: false });

    const kolommen = (
      handle.raw.prepare('PRAGMA table_xinfo(projects)').all() as Array<{ name: string }>
    ).map((rij) => rij.name);
    expect(kolommen).not.toContain('cf_bouwstroom_idx');
  });
});

describe('een formuleveld', () => {
  it('wordt bij het lezen uitgerekend en kan niet worden ingevuld', async () => {
    await post('/api/v1/fields', {
      entity_key: 'projects',
      label: 'Omzet per woning',
      type: 'formula',
      validation: { expression: 'ROND(contract_value_cents / unit_count / 100, 2)' },
    });

    const projectId = (await get('/api/v1/projects')).json().data[0].id;
    await patch(`/api/v1/projects/${projectId}`, {
      unit_count: 24,
      contract_value_cents: 6_000_000,
    });

    const record = await get(`/api/v1/projects/${projectId}`);
    expect(record.json().data.custom_fields.cf_omzet_per_woning).toBe(2500);

    const invullen = await patch(`/api/v1/projects/${projectId}`, {
      custom_fields: { cf_omzet_per_woning: 99 },
    });
    expect(invullen.statusCode).toBe(400);
    expect(invullen.json().error.message).toContain('wordt berekend');
  });

  it('weigert een formule die niet klopt, voordat hij wordt opgeslagen', async () => {
    const response = await post('/api/v1/fields', {
      entity_key: 'projects',
      label: 'Kapot',
      type: 'formula',
      validation: { expression: '1 +' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('formule_ongeldig');
  });

  it('controleert een formule los, voor de editor', async () => {
    const goed = await post('/api/v1/fields/check-formula', { expression: 'unit_count * 2' });
    expect(goed.json().data).toEqual({ ok: true, velden: ['unit_count'] });

    const fout = await post('/api/v1/fields/check-formula', { expression: 'STIEKEM(1)' });
    expect(fout.json().data.ok).toBe(false);
  });
});

describe('opgeslagen weergaven', () => {
  it('past kolommen, filter en sortering van een weergave toe', async () => {
    await post('/api/v1/saved-views', {
      entity_key: 'projects',
      name: 'Alleen Breda',
      is_shared: 1,
      columns: ['name', 'city'],
      filters: { field: 'city', operator: 'eq', value: 'Breda' },
      sort: [{ field: 'name', direction: 'desc' }],
    });

    const response = await get('/api/v1/projects?view=Alleen%20Breda');
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0].city).toBe('Breda');
    expect(response.json().meta.weergave).toMatchObject({ naam: 'Alleen Breda' });
  });

  it('laat een eigen filter voorgaan op dat van de weergave', async () => {
    await post('/api/v1/saved-views', {
      entity_key: 'projects',
      name: 'Alleen Breda',
      columns: [],
      filters: { field: 'city', operator: 'eq', value: 'Breda' },
    });

    const response = await get(
      `/api/v1/projects?view=Alleen%20Breda&filter=${filterVoor({ field: 'city', operator: 'eq', value: 'Tilburg' })}`,
    );
    expect(response.json().data.every((rij: { city: string }) => rij.city === 'Tilburg')).toBe(true);
  });

  it('meldt een onbekende weergave netjes', async () => {
    const response = await get('/api/v1/projects?view=bestaat-niet');
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('weergave_onbekend');
  });
});
