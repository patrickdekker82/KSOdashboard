/**
 * API-tests voor de AI-assistent (hoofdstuk 6.8).
 *
 * De belangrijkste twee: zonder sleutel gaat er niets weg, en de rechten
 * kloppen — een meekijker mag geen sleutel invoeren en geen logboek zien.
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
import type { Model, Verzoek } from './client.ts';
import { zetTestmodel } from './routes.ts';

const APP_TOKEN = 'test-token-abcdefghijklmnop';

let directory: string;
let handle: DatabaseHandle;
let app: FastifyInstance;
let beheerder: string;
let manager: string;
let meekijker: string;
let ontvangen: Verzoek[];

/**
 * Doet wat het echte model doet: het schrijft een tekst waarin de
 * plaatshouders uit het verzoek terugkomen. Zo toetst de test de hele
 * rondgang — vervangen, versturen, terugzetten — in plaats van een vast
 * antwoord dat toevallig klopt.
 */
const nepModel: Model = {
  vraag: async (verzoek) => {
    ontvangen.push(verzoek);
    const plaatshouders = [...new Set(verzoek.gebruiker.match(/«[A-Z]+_\d+»/gu) ?? [])];

    return {
      tekst: `Beste ${plaatshouders.join(' en ')}, hierbij mijn opvolging.`,
      invoertokens: 900,
      uitvoertokens: 120,
      reden: 'end_turn',
    };
  },
};

beforeEach(async () => {
  ontvangen = [];
  directory = mkdtempSync(join(tmpdir(), 'showroom-ai-api-'));
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
  zetTestmodel(null);
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
const put = (url: string, payload: InjectPayload, cookie = beheerder): Antwoord =>
  app.inject({ method: 'PUT', url, headers: headers(cookie), payload });
const patch = (url: string, payload: InjectPayload, cookie = beheerder): Antwoord =>
  app.inject({ method: 'PATCH', url, headers: headers(cookie), payload });

function eersteKlant(): number {
  const rij = handle.raw.prepare('SELECT MIN(id) AS id FROM organizations').get() as { id: number };
  return rij.id;
}

function presetVoorOpvolging(): number {
  const rij = handle.raw
    .prepare("SELECT id FROM ai_presets WHERE name LIKE 'Opvolg%'")
    .get() as { id: number };
  return rij.id;
}

describe('standaard uit', () => {
  it('meldt dat de assistent uit staat', async () => {
    const response = await get('/api/v1/ai/status');

    expect(response.statusCode).toBe(200);
    expect(response.json().data.ingeschakeld).toBe(false);
  });

  it('weigert uitvoeren zolang er geen sleutel is', async () => {
    const response = await post('/api/v1/ai/run', {
      presetId: presetVoorOpvolging(),
      entity: 'organizations',
      recordId: eersteKlant(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ai_uit');
  });

  it('laat voorbeeld tonen zonder sleutel — daar gaat immers niets weg', async () => {
    const response = await post('/api/v1/ai/preview', {
      presetId: presetVoorOpvolging(),
      entity: 'organizations',
      recordId: eersteKlant(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.gebruiker).toContain('«');
  });
});

describe('de sleutel', () => {
  it('mag alleen door een beheerder worden gezet', async () => {
    const response = await put('/api/v1/ai/key', { key: 'sk-ant-test' }, manager);

    expect(response.statusCode).toBe(403);
  });

  it('weigert iets dat geen sleutel is', async () => {
    const response = await put('/api/v1/ai/key', { key: 'zomaar wat' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('sleutel_vorm');
  });

  it('zet de assistent aan en weer uit', async () => {
    expect((await put('/api/v1/ai/key', { key: 'sk-ant-test-1234' })).statusCode).toBe(200);
    expect((await get('/api/v1/ai/status')).json().data.ingeschakeld).toBe(true);

    expect((await put('/api/v1/ai/key', { key: '' })).statusCode).toBe(200);
    expect((await get('/api/v1/ai/status')).json().data.ingeschakeld).toBe(false);
  });
});

describe('uitvoeren', () => {
  beforeEach(() => {
    zetTestmodel(nepModel);
  });

  it('stuurt geen persoonsgegevens mee en levert een ingevuld antwoord', async () => {
    const naam = (
      handle.raw.prepare('SELECT name FROM organizations WHERE id = ?').get(eersteKlant()) as {
        name: string;
      }
    ).name;

    const response = await post('/api/v1/ai/run', {
      presetId: presetVoorOpvolging(),
      entity: 'organizations',
      recordId: eersteKlant(),
    });

    expect(response.statusCode).toBe(200);
    expect(ontvangen).toHaveLength(1);
    expect(ontvangen[0]!.gebruiker).not.toContain(naam);
    expect(ontvangen[0]!.gebruiker).toContain('«');

    // En terug: geen plaatshouder meer over, de echte naam er weer in.
    expect(response.json().data.tekst).toContain(naam);
    expect(response.json().data.tekst).not.toContain('«');
    expect(response.json().data.onbekend).toEqual([]);
    expect(response.json().data.invoertokens).toBe(900);
  });

  it('weigert een onbekend onderwerp', async () => {
    const response = await post('/api/v1/ai/run', {
      presetId: presetVoorOpvolging(),
      entity: 'absences',
      recordId: 1,
    });

    expect(response.statusCode).toBe(400);
  });

  it('weigert een preset die niet bestaat', async () => {
    const response = await post('/api/v1/ai/run', {
      presetId: 99999,
      entity: 'organizations',
      recordId: eersteKlant(),
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('presets beheren', () => {
  it('laat een manager het model niet op iets onbekends zetten', async () => {
    const response = await patch(
      `/api/v1/ai/presets/${presetVoorOpvolging()}`,
      { model: 'gpt-vier' },
      manager,
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('model_onbekend');
  });

  it('laat een meekijker niets wijzigen', async () => {
    const response = await patch(
      `/api/v1/ai/presets/${presetVoorOpvolging()}`,
      { actief: false },
      meekijker,
    );

    expect(response.statusCode).toBe(403);
  });

  it('bewaart een gewijzigde preset', async () => {
    const response = await patch(
      `/api/v1/ai/presets/${presetVoorOpvolging()}`,
      { anonimiseren: false, context: ['record', 'onzin'], maxTokens: 1024 },
      manager,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.anonimiseren).toBe(false);
    expect(response.json().data.context).toEqual(['record']);
    expect(response.json().data.maxTokens).toBe(1024);
  });
});

describe('het logboek', () => {
  it('is niet voor een meekijker', async () => {
    expect((await get('/api/v1/ai/runs', meekijker)).statusCode).toBe(403);
  });

  it('toont wat er gedraaid heeft, met het verbruik per maand', async () => {
    zetTestmodel(nepModel);
    await post('/api/v1/ai/run', {
      presetId: presetVoorOpvolging(),
      entity: 'organizations',
      recordId: eersteKlant(),
    });

    const response = await get('/api/v1/ai/runs', manager);

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0].preset_naam).toContain('Opvolg');
    expect(response.json().meta.perMaand[0].aanroepen).toBe(1);
  });
});
