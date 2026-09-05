/** Endpoints voor de AI-assistent (hoofdstuk 6.8). */
import type { FastifyInstance } from 'fastify';
import { ApiError, currentUser, requireRole } from '../../server.ts';
import { bewaarGeheim, heeftGeheim, KluisFout, leesGeheim } from '../secrets/kluis.ts';
import { AiFout, maakModel, type Model } from './client.ts';
import { CONTEXTBLOKKEN, ONDERWERPEN } from './dossier.ts';
import { MODELLEN, PRIJZEN } from './prijzen.ts';
import { bereidVoor, laadPreset, laadPresets, verbruikPerMaand, voerUit } from './uitvoeren.ts';

type Rij = Record<string, unknown>;

/** Onder welke naam de API-sleutel in de kluis staat. */
export const SLEUTELNAAM = 'anthropic_api_key';

/**
 * Voor de tests: een model dat in de plaats komt van de echte koppeling.
 * In productie blijft dit `null` en wordt er een echte client gemaakt.
 */
let vervangendModel: Model | null = null;

/** Alleen voor tests. Geef `null` om de echte koppeling terug te zetten. */
export function zetTestmodel(model: Model | null): void {
  vervangendModel = model;
}

/** Vertaalt een modulefout naar een nette API-fout. */
function vang<T>(fn: () => T): T {
  try {
    return fn();
  } catch (fout) {
    throw naarApi(fout);
  }
}

function naarApi(fout: unknown): unknown {
  if (fout instanceof AiFout) {
    const status =
      fout.code === 'niet_gevonden'
        ? 404
        : fout.code === 'sleutel_ongeldig' || fout.code === 'geen_toegang'
          ? 502
          : fout.code === 'geen_verbinding' || fout.code === 'te_druk' || fout.code === 'api_fout'
            ? 502
            : 400;
    return new ApiError(status, fout.code, fout.message);
  }
  if (fout instanceof KluisFout) return new ApiError(500, fout.code, fout.message);
  return fout;
}

export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Of de assistent bruikbaar is.
   *
   * Zonder sleutel is de hele functie uit — dat is de stand waarin de
   * applicatie geïnstalleerd wordt, en dat is bewust: er gaat pas iets naar
   * buiten als een beheerder daar zelf voor kiest.
   */
  app.get('/api/v1/ai/status', async (request) => {
    currentUser(request);

    return {
      data: {
        ingeschakeld: heeftGeheim(request.core.handle, SLEUTELNAAM) || vervangendModel !== null,
        modellen: MODELLEN.map((model) => ({
          id: model,
          prijsBekend: PRIJZEN.has(model),
        })),
        onderwerpen: [...ONDERWERPEN.keys()],
        contextblokken: [...CONTEXTBLOKKEN],
      },
    };
  });

  /** De sleutel invoeren of wissen. Alleen een beheerder. */
  app.put('/api/v1/ai/key', async (request, reply) => {
    requireRole(request, 'admin');
    const body = (request.body ?? {}) as Rij;
    const sleutel = typeof body.key === 'string' ? body.key.trim() : '';

    if (sleutel !== '' && !sleutel.startsWith('sk-')) {
      throw new ApiError(
        400,
        'sleutel_vorm',
        'Dit ziet er niet uit als een API-sleutel. Een sleutel begint met "sk-".',
      );
    }

    vang(() => bewaarGeheim(request.core.handle, request.core.dataDirectory, SLEUTELNAAM, sleutel));

    return reply.code(200).send({
      data: { ingeschakeld: sleutel !== '' },
    });
  });

  /** De presets. Iedereen mag ze zien; alleen een manager mag ze wijzigen. */
  app.get('/api/v1/ai/presets', async (request) => {
    currentUser(request);
    const alleenActieve = (request.query as Rij).active === 'true';

    return { data: laadPresets(request.core.handle, alleenActieve) };
  });

  app.patch('/api/v1/ai/presets/:id', async (request) => {
    requireRole(request, 'manager');
    const presetId = Number((request.params as Rij).id);
    const preset = laadPreset(request.core.handle, presetId);
    if (preset === null) throw new ApiError(404, 'niet_gevonden', 'Deze preset bestaat niet.');

    const body = (request.body ?? {}) as Rij;
    const kolommen: string[] = [];
    const waarden: Array<string | number> = [];

    const zetTekst = (veld: string, kolom: string): void => {
      if (typeof body[veld] === 'string') {
        kolommen.push(`${kolom} = ?`);
        waarden.push(body[veld]);
      }
    };

    zetTekst('naam', 'name');
    zetTekst('omschrijving', 'description');
    zetTekst('systeemPrompt', 'system_prompt');
    zetTekst('gebruikersSjabloon', 'user_prompt_template');

    if (typeof body.model === 'string') {
      if (!MODELLEN.includes(body.model as (typeof MODELLEN)[number])) {
        throw new ApiError(400, 'model_onbekend', `Het model "${body.model}" is hier niet bekend.`);
      }
      kolommen.push('model = ?');
      waarden.push(body.model);
    }

    if (typeof body.maxTokens === 'number' && Number.isInteger(body.maxTokens)) {
      if (body.maxTokens < 256 || body.maxTokens > 32000) {
        throw new ApiError(400, 'ongeldig', 'Kies een lengte tussen 256 en 32000 tokens.');
      }
      kolommen.push('max_tokens = ?');
      waarden.push(body.maxTokens);
    }

    if (Array.isArray(body.context)) {
      const blokken = body.context.map(String).filter((blok) => CONTEXTBLOKKEN.has(blok));
      kolommen.push('include_context = ?');
      waarden.push(JSON.stringify(blokken));
    }

    if (typeof body.anonimiseren === 'boolean') {
      kolommen.push('anonymise_personal_data = ?');
      waarden.push(body.anonimiseren ? 1 : 0);
    }

    if (typeof body.actief === 'boolean') {
      kolommen.push('active = ?');
      waarden.push(body.actief ? 1 : 0);
    }

    if (kolommen.length === 0) {
      throw new ApiError(400, 'niets_te_wijzigen', 'Er is niets opgegeven om te wijzigen.');
    }

    kolommen.push("updated_at = datetime('now')");
    request.core.handle.raw
      .prepare(`UPDATE ai_presets SET ${kolommen.join(', ')} WHERE id = ?`)
      .run(...waarden, presetId);

    return { data: laadPreset(request.core.handle, presetId) };
  });

  /**
   * Laat zien wat er verstuurd zou worden, zonder iets te versturen.
   *
   * Dit is de knop "Bekijk wat er weggaat". Wie hem gebruikt ziet letterlijk
   * de tekst die de deur uit gaat — inclusief de plaatshouders.
   */
  app.post('/api/v1/ai/preview', async (request) => {
    const gebruiker = currentUser(request);
    const opdracht = leesOpdracht(request.body);

    const voorbereid = vang(() => bereidVoor(request.core.handle, opdracht, gebruiker.id));

    return {
      data: {
        systeem: voorbereid.systeem,
        gebruiker: voorbereid.gebruiker,
        model: voorbereid.preset.model,
        anonimiseren: voorbereid.preset.anonimiseren,
        vervangen: voorbereid.woordenboek.vervangingen.map((vervanging) => ({
          soort: vervanging.soort,
          plaatshouder: vervanging.plaatshouder,
        })),
        ontbrekend: voorbereid.ontbrekend,
      },
    };
  });

  /** De preset echt uitvoeren. Dit is de enige route die het netwerk op gaat. */
  app.post('/api/v1/ai/run', async (request) => {
    const gebruiker = currentUser(request);
    const opdracht = leesOpdracht(request.body);

    let model = vervangendModel;
    if (model === null) {
      const sleutel = vang(() =>
        leesGeheim(request.core.handle, request.core.dataDirectory, SLEUTELNAAM),
      );
      if (sleutel === null) {
        throw new ApiError(
          409,
          'ai_uit',
          'De AI-assistent staat uit. Een beheerder kan bij Instellingen › AI een API-sleutel invullen.',
        );
      }
      model = maakModel(sleutel);
    }

    try {
      return { data: await voerUit(request.core.handle, model, opdracht, gebruiker.id) };
    } catch (fout) {
      throw naarApi(fout);
    }
  });

  /** Het logboek: wat er is gevraagd, door wie, en wat het kostte. */
  app.get('/api/v1/ai/runs', async (request) => {
    requireRole(request, 'manager');
    const query = request.query as Rij;
    const limiet = Math.min(Math.max(Number(query.limit ?? 100), 1), 500);

    const rijen = request.core.handle.raw
      .prepare(
        `SELECT r.*, p.name AS preset_naam, u.name AS gebruiker_naam
           FROM ai_runs r
      LEFT JOIN ai_presets p ON p.id = r.preset_id
      LEFT JOIN users u      ON u.id = r.user_id
       ORDER BY r.created_at DESC, r.id DESC
          LIMIT ?`,
      )
      .all(limiet) as Rij[];

    return {
      data: rijen,
      meta: { perMaand: verbruikPerMaand(request.core.handle) },
    };
  });
}

/** Leest en controleert de opdracht uit de body. */
function leesOpdracht(body: unknown): {
  presetId: number;
  entiteit: string;
  recordId: number;
  aanvulling?: string;
} {
  const rij = (body ?? {}) as Rij;
  const presetId = Number(rij.presetId);
  const recordId = Number(rij.recordId);
  const entiteit = String(rij.entity ?? '');

  if (!Number.isInteger(presetId) || presetId <= 0) {
    throw new ApiError(400, 'onvolledig', 'Geef op welke preset u wilt gebruiken.');
  }
  if (!ONDERWERPEN.has(entiteit) || !Number.isInteger(recordId) || recordId <= 0) {
    throw new ApiError(400, 'onvolledig', 'Geef een geldig onderwerp en recordnummer op.');
  }

  const aanvulling = typeof rij.aanvulling === 'string' ? rij.aanvulling.slice(0, 4000) : undefined;
  return { presetId, entiteit, recordId, aanvulling };
}
