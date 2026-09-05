/**
 * API-tests voor rapportages en export (hoofdstuk 11).
 *
 * Twee vragen: klopt wat eruit komt, en komt niemand ergens waar hij niet
 * hoort. Dat laatste is hier belangrijker dan elders — een rapportage kan bij
 * alle tabellen, ook die waar de schermen een meekijker niet in laten.
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
import { leesWerkblad } from '../import/xlsx.ts';
import { leesOpNaam } from '../import/zip.ts';
import { veiligeBestandsnaam } from './routes.ts';

const APP_TOKEN = 'test-token-abcdefghijklmnop';

let directory: string;
let handle: DatabaseHandle;
let app: FastifyInstance;
let beheerder: string;
let manager: string;
let meekijker: string;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'showroom-rap-'));
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
  manager = await login('manager@showroom.local');
  meekijker = await login('acquisitie@showroom.local');
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
const del = (url: string, cookie = beheerder): Antwoord =>
  app.inject({ method: 'DELETE', url, headers: headers(cookie) });

const KLANTENRAPPORT = {
  entiteit: 'organizations',
  kolommen: [
    { veld: 'name', kop: 'Klant' },
    { veld: 'city', kop: 'Plaats' },
  ],
  sortering: [{ veld: 'name' }],
};

describe('wat er te rapporteren valt', () => {
  it('noemt de gegevenssoorten met hun kolommen', async () => {
    const response = await get('/api/v1/reports/entities', manager);
    const klanten = response
      .json()
      .data.find((entiteit: { sleutel: string }) => entiteit.sleutel === 'organizations');

    expect(response.statusCode).toBe(200);
    expect(klanten.kolommen.map((kolom: { sleutel: string }) => kolom.sleutel)).toContain('name');
  });

  it('geeft het volledige schema alleen aan een beheerder', async () => {
    expect((await get('/api/v1/reports/schema')).statusCode).toBe(200);
    expect((await get('/api/v1/reports/schema', manager)).statusCode).toBe(403);
  });
});

describe('draaien', () => {
  it('levert rijen met de gekozen koppen', async () => {
    const response = await post('/api/v1/reports/run', KLANTENRAPPORT, manager);
    const data = response.json().data;

    expect(response.statusCode).toBe(200);
    expect(data.kolommen.map((kolom: { kop: string }) => kolom.kop)).toEqual(['Klant', 'Plaats']);
    expect(data.rijen.length).toBeGreaterThan(0);
    expect(Object.keys(data.rijen[0])).toEqual(['Klant', 'Plaats']);
  });

  it('weigert een veld dat niet bestaat', async () => {
    const response = await post(
      '/api/v1/reports/run',
      { entiteit: 'organizations', kolommen: [{ veld: 'geheim' }] },
      manager,
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('onbekend_veld');
  });

  it('weigert een rapportage zonder kolommen', async () => {
    const response = await post(
      '/api/v1/reports/run',
      { entiteit: 'organizations', kolommen: [] },
      manager,
    );

    expect(response.statusCode).toBe(400);
  });
});

describe('de SQL-modus', () => {
  it('is alleen voor een beheerder', async () => {
    const query = { sql: 'SELECT name FROM organizations LIMIT 3' };

    expect((await post('/api/v1/reports/run', query)).statusCode).toBe(200);
    expect((await post('/api/v1/reports/run', query, manager)).statusCode).toBe(403);
    expect((await post('/api/v1/reports/run', query, meekijker)).statusCode).toBe(403);
  });

  it('weigert alles wat niet leest', async () => {
    const response = await post('/api/v1/reports/run', { sql: 'DELETE FROM organizations' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('alleen_select');

    // En de gegevens staan er nog.
    const aantal = handle.raw.prepare('SELECT COUNT(*) AS n FROM organizations').get() as {
      n: number;
    };
    expect(aantal.n).toBeGreaterThan(0);
  });
});

describe('exporteren', () => {
  it('levert een werkmap die met de eigen lezer open te krijgen is', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { ...KLANTENRAPPORT, formaat: 'xlsx', titel: 'Klanten' },
      manager,
    );
    const data = response.json().data;

    expect(response.statusCode).toBe(200);
    expect(data.bestandsnaam).toBe('Klanten.xlsx');
    expect(data.codering).toBe('base64');

    const rijen = leesWerkblad(Buffer.from(data.inhoud, 'base64')).rijen;
    expect(rijen[0]).toEqual(['Klant', 'Plaats']);
    expect(rijen.length).toBeGreaterThan(1);
  });

  it('levert een Word-document met de titel en de maker erin', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { ...KLANTENRAPPORT, formaat: 'docx', titel: 'Klanten' },
      manager,
    );
    const xml =
      leesOpNaam(Buffer.from(response.json().data.inhoud, 'base64'), 'word/document.xml')?.toString(
        'utf8',
      ) ?? '';

    expect(response.json().data.bestandsnaam).toBe('Klanten.docx');
    expect(xml).toContain('Klanten');
    expect(xml).toContain('Marieke Manager');
  });

  it('levert een CSV met puntkomma en BOM', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { ...KLANTENRAPPORT, formaat: 'csv', titel: 'Klanten' },
      manager,
    );
    const data = response.json().data;

    expect(data.codering).toBe('tekst');
    expect(data.inhoud.startsWith('﻿')).toBe(true);
    expect(data.inhoud).toContain('Klant;Plaats');
  });

  it('weigert een formaat dat niet bestaat', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { ...KLANTENRAPPORT, formaat: 'pdf-achtig' },
      manager,
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('onbekend_formaat');
  });

  it('maakt een bestandsnaam waar Windows niet over valt', () => {
    expect(veiligeBestandsnaam('Kansen: Q3/2026', 'xlsx')).toBe('Kansen Q3 2026.xlsx');
    expect(veiligeBestandsnaam('   ', 'csv')).toBe('rapportage.csv');
  });
});

describe('opgeslagen rapportages', () => {
  it('bewaart, toont en verwijdert', async () => {
    const bewaard = await post(
      '/api/v1/reports/saved',
      { naam: 'Klanten per plaats', definitie: KLANTENRAPPORT, gedeeld: true },
      manager,
    );

    expect(bewaard.statusCode).toBe(200);
    expect(bewaard.json().data.modus).toBe('builder');
    expect(bewaard.json().data.definitie.entiteit).toBe('organizations');

    const lijst = await get('/api/v1/reports/saved', manager);
    expect(lijst.json().data).toHaveLength(1);

    const weg = await del(`/api/v1/reports/saved/${bewaard.json().data.id}`, manager);
    expect(weg.statusCode).toBe(200);
    expect((await get('/api/v1/reports/saved', manager)).json().data).toHaveLength(0);
  });

  it('houdt een niet-gedeelde rapportage bij de maker', async () => {
    await post(
      '/api/v1/reports/saved',
      { naam: 'Alleen voor mij', definitie: KLANTENRAPPORT, gedeeld: false },
      manager,
    );

    expect((await get('/api/v1/reports/saved', manager)).json().data).toHaveLength(1);
    expect((await get('/api/v1/reports/saved', meekijker)).json().data).toHaveLength(0);
  });

  it('laat een gedeelde rapportage niet door een ander verwijderen', async () => {
    const bewaard = await post(
      '/api/v1/reports/saved',
      { naam: 'Gedeeld', definitie: KLANTENRAPPORT, gedeeld: true },
      manager,
    );

    const geweigerd = await del(`/api/v1/reports/saved/${bewaard.json().data.id}`, meekijker);
    expect(geweigerd.statusCode).toBe(403);

    // Een beheerder mag het wel.
    expect((await del(`/api/v1/reports/saved/${bewaard.json().data.id}`)).statusCode).toBe(200);
  });

  it('laat een manager geen SQL-rapportage bewaren', async () => {
    const response = await post(
      '/api/v1/reports/saved',
      { naam: 'Stiekem', sql: 'SELECT 1' },
      manager,
    );

    expect(response.statusCode).toBe(403);
  });

  it('weigert een rapportage zonder naam', async () => {
    expect(
      (await post('/api/v1/reports/saved', { definitie: KLANTENRAPPORT }, manager)).statusCode,
    ).toBe(400);
  });
});
