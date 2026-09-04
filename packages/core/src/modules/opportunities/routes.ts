/** Endpoints voor kansen: fasewissel, winnen, verliezen en rapportage. */
import type { FastifyInstance } from 'fastify';
import { ApiError, currentUser } from '../../server.ts';
import { herberekenAlles } from './recalculate.ts';
import {
  KansFout,
  laadFasen,
  maakProjectVanKans,
  verliesKans,
  verouderdeKansen,
  winKans,
  wisselFase,
  type WinRegel,
} from './stages.ts';
import {
  doorlooptijdPerFase,
  omzetPerDiscipline,
  samenvatting,
  trechter,
  verliesredenen,
  winRate,
} from './reports.ts';

type Rij = Record<string, unknown>;

/** Vertaalt een KansFout naar een nette API-fout. */
function vang<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof KansFout) {
      throw new ApiError(error.code === 'niet_gevonden' ? 404 : 400, error.code, error.message);
    }
    throw error;
  }
}

export async function registerOpportunityRoutes(app: FastifyInstance): Promise<void> {
  /** De fasen van de pijplijn, met kleur en verouderingsgrens. */
  app.get('/api/v1/opportunities/stages', async (request) => {
    const pipelineId = Number((request.query as Rij).pipelineId ?? 0);
    return { data: laadFasen(request.core.handle, pipelineId > 0 ? pipelineId : undefined) };
  });

  /**
   * Het kanbanbord: per fase de kansen die erin staan.
   *
   * In één verzoek, want een bord dat per kolom een aanroep doet, flikkert bij
   * elke versleping.
   */
  app.get('/api/v1/opportunities/board', async (request) => {
    const handle = request.core.handle;
    const query = request.query as Rij;
    const eigenaar = query.ownerId === undefined ? null : Number(query.ownerId);

    const fasen = laadFasen(handle);
    const kansen = handle.raw
      .prepare(
        `SELECT k.id, k.number, k.name, k.stage_id, k.status, k.amount_cents,
                k.weighted_amount_cents, k.probability_bp, k.expected_close_date,
                k.last_activity_at, k.stage_changed_at, k.expected_units,
                o.name AS organisatie, u.initials AS eigenaar
           FROM opportunities k
      LEFT JOIN organizations o ON o.id = k.organization_id
      LEFT JOIN users u ON u.id = k.owner_user_id
          WHERE k.archived_at IS NULL AND k.status = 'open'
            ${eigenaar ? 'AND k.owner_user_id = ?' : ''}
          ORDER BY k.updated_at DESC`,
      )
      .all(...((eigenaar ? [eigenaar] : []) as never[])) as Rij[];

    const verouderd = new Map(
      verouderdeKansen(handle).map((kans) => [kans.id, kans.dagenStil]),
    );

    return {
      data: {
        fasen,
        kansen: kansen.map((kans) => ({
          ...kans,
          dagen_stil: verouderd.get(Number(kans.id)) ?? null,
        })),
      },
    };
  });

  /** Een kans naar een andere fase verplaatsen (slepen op het bord). */
  app.post('/api/v1/opportunities/:id/stage', async (request) => {
    const user = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const stageId = Number((request.body as { stageId?: number } | undefined)?.stageId);
    if (!Number.isInteger(stageId) || stageId <= 0) {
      throw new ApiError(400, 'onvolledig', 'Geef aan naar welke fase de kans moet.');
    }

    const handle = request.core.handle;
    const doel = handle.raw
      .prepare('SELECT is_won, is_lost, name FROM pipeline_stages WHERE id = ?')
      .get(stageId) as Rij | undefined;

    // Winnen en verliezen gaan niet via slepen: daar hoort een gescoord bedrag
    // per discipline of een verliesreden bij (hoofdstuk 6.2).
    if (doel && Number(doel.is_won) === 1) {
      throw new ApiError(
        400,
        'gebruik_winnen',
        `Verplaats een kans niet zomaar naar "${String(doel.name)}". Gebruik "Gewonnen" ` +
          'zodat u per discipline het daadwerkelijk gescoorde bedrag kunt invullen.',
      );
    }
    if (doel && Number(doel.is_lost) === 1) {
      throw new ApiError(
        400,
        'gebruik_verliezen',
        `Verplaats een kans niet zomaar naar "${String(doel.name)}". Gebruik "Verloren" ` +
          'zodat u de reden kunt vastleggen.',
      );
    }

    return { data: vang(() => wisselFase(handle, id, stageId, user.id)) };
  });

  /** Winnen, met per regel het gescoorde bedrag. */
  app.post('/api/v1/opportunities/:id/win', async (request) => {
    const user = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as {
      regels?: Array<{ lineId?: number; wonAmountCents?: number }>;
      maakProject?: boolean;
    };

    const regels: WinRegel[] = (body.regels ?? []).map((regel) => ({
      lineId: Number(regel.lineId),
      wonAmountCents: Number(regel.wonAmountCents ?? 0),
    }));

    return {
      data: vang(() =>
        winKans(request.core.handle, id, regels, user.id, { maakProject: body.maakProject }),
      ),
    };
  });

  /** Verliezen, met verplichte reden. */
  app.post('/api/v1/opportunities/:id/lose', async (request) => {
    const user = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as { redenId?: number | null; notitie?: string };

    return {
      data: vang(() =>
        verliesKans(
          request.core.handle,
          id,
          body.redenId === undefined || body.redenId === null ? null : Number(body.redenId),
          body.notitie ?? null,
          user.id,
        ),
      ),
    };
  });

  /** Een showroomproject aanmaken uit een gewonnen kans. */
  app.post('/api/v1/opportunities/:id/create-project', async (request, reply) => {
    const user = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const projectId = vang(() => maakProjectVanKans(request.core.handle, id, user.id));
    return reply.code(201).send({ data: { projectId } });
  });

  /** De fasehistorie van één kans. */
  app.get('/api/v1/opportunities/:id/history', async (request) => {
    const id = Number((request.params as { id: string }).id);
    const rijen = request.core.handle.raw
      .prepare(
        `SELECT h.id, h.at, h.days_in_stage, van.name AS van_fase, naar.name AS naar_fase,
                u.name AS door
           FROM opportunity_stage_history h
      LEFT JOIN pipeline_stages van ON van.id = h.from_stage_id
      LEFT JOIN pipeline_stages naar ON naar.id = h.to_stage_id
      LEFT JOIN users u ON u.id = h.user_id
          WHERE h.opportunity_id = ?
          ORDER BY h.at DESC`,
      )
      .all(id) as Rij[];
    return { data: rijen };
  });

  /** Kansen die te lang stilstaan. */
  app.get('/api/v1/opportunities/stale', async (request) => ({
    data: verouderdeKansen(request.core.handle),
  }));

  /** Alles opnieuw doorrekenen, bijvoorbeeld na een import. */
  app.post('/api/v1/opportunities/recalculate', async (request) => {
    currentUser(request);
    return { data: { kansen: herberekenAlles(request.core.handle) } };
  });

  // --- rapportage -----------------------------------------------------------
  app.get('/api/v1/reports/pipeline', async (request) => {
    const query = request.query as Rij;
    const pipelineId = Number(query.pipelineId ?? 0);
    const handle = request.core.handle;
    const van = query.from === undefined ? undefined : String(query.from);
    const tot = query.to === undefined ? undefined : String(query.to);

    return {
      data: {
        samenvatting: samenvatting(handle, query.year ? Number(query.year) : undefined),
        trechter: trechter(handle, pipelineId > 0 ? pipelineId : undefined),
        winRatePerDiscipline: winRate(handle, 'discipline', van, tot),
        winRatePerEigenaar: winRate(handle, 'eigenaar', van, tot),
        winRatePerBron: winRate(handle, 'bron', van, tot),
        doorlooptijd: doorlooptijdPerFase(handle),
        omzetPerDiscipline: omzetPerDiscipline(handle, van, tot),
        verliesredenen: verliesredenen(handle),
      },
      meta: { van, tot },
    };
  });
}
