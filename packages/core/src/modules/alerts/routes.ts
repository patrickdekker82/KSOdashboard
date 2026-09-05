/** Endpoints voor de signaleringen (hoofdstuk 8.2). */
import type { FastifyInstance } from 'fastify';
import { ApiError, currentUser, requireRole } from '../../server.ts';
import { laadMeldingen, telMeldingen, voerControleUit, type MeldingFilter } from './engine.ts';
import { REGELS } from './rules.ts';
import type { Ernst } from './types.ts';

type Rij = Record<string, unknown>;

const ERNSTEN = new Set<Ernst>(['info', 'let_op', 'urgent']);
const STATUSSEN = new Set(['open', 'bevestigd', 'uitgesteld', 'opgelost']);

/** Leest een lijstparameter: `?severity=urgent,let_op`. */
function lijst(waarde: unknown, toegestaan: ReadonlySet<string>): string[] | undefined {
  if (typeof waarde !== 'string' || waarde.trim() === '') return undefined;
  const delen = waarde
    .split(',')
    .map((deel) => deel.trim())
    .filter((deel) => toegestaan.has(deel));
  return delen.length > 0 ? delen : undefined;
}

export async function registerAlertRoutes(app: FastifyInstance): Promise<void> {
  /** De meldingen voor het dashboard. */
  app.get('/api/v1/alerts', async (request) => {
    currentUser(request);
    const query = request.query as Rij;

    const filter: MeldingFilter = {
      status: lijst(query.status, STATUSSEN),
      ernst: lijst(query.severity, ERNSTEN) as Ernst[] | undefined,
      verbergUitgesteld: query.includeSnoozed !== 'true',
      limiet: query.limit === undefined ? undefined : Number(query.limit),
    };

    const meldingen = laadMeldingen(request.core.handle, filter);
    return {
      data: meldingen,
      meta: { telling: telMeldingen(request.core.handle) },
    };
  });

  /** Alleen de aantallen, voor het bolletje in de kopbalk. */
  app.get('/api/v1/alerts/count', async (request) => {
    currentUser(request);
    return { data: telMeldingen(request.core.handle) };
  });

  /**
   * De regels, met de stand van zaken erbij.
   *
   * Regeltypes zonder code worden als zodanig gemarkeerd. Zo is te zien dat een
   * regel bestaat maar nog niets doet, in plaats van dat hij stil nooit afgaat.
   */
  app.get('/api/v1/alerts/rules', async (request) => {
    currentUser(request);
    const rijen = request.core.handle.raw
      .prepare(
        `SELECT r.*,
                (SELECT COUNT(*) FROM alerts a
                  WHERE a.rule_id = r.id AND a.status IN ('open','bevestigd','uitgesteld')) AS openstaand
           FROM alert_rules r
          WHERE r.archived_at IS NULL
          ORDER BY r.severity = 'urgent' DESC, r.name`,
      )
      .all() as Rij[];

    return {
      data: rijen.map((rij) => ({ ...rij, gebouwd: REGELS.has(String(rij.type)) })),
    };
  });

  /** Nu doorrekenen, in plaats van wachten op de uurlijkse controle. */
  app.post('/api/v1/alerts/run', async (request) => {
    requireRole(request, 'manager');
    const body = (request.body ?? {}) as { regelId?: number };
    const regelId = body.regelId === undefined ? undefined : Number(body.regelId);
    return { data: voerControleUit(request.core.handle, new Date(), regelId) };
  });

  // --- afhandelen -----------------------------------------------------------

  /** Gezien: de melding blijft staan zolang de situatie bestaat, maar valt op de achtergrond. */
  app.post('/api/v1/alerts/:id/acknowledge', async (request) => {
    const gebruiker = currentUser(request);
    const id = Number((request.params as { id: string }).id);

    const resultaat = request.core.handle.raw
      .prepare(
        `UPDATE alerts
            SET status = 'bevestigd', acknowledged_by = ?, acknowledged_at = datetime('now')
          WHERE id = ? AND status IN ('open', 'uitgesteld')`,
      )
      .run(gebruiker.id, id);

    if (Number(resultaat.changes ?? 0) === 0) {
      throw new ApiError(404, 'niet_gevonden', 'Deze melding bestaat niet of is al afgehandeld.');
    }
    return { data: { id, status: 'bevestigd' } };
  });

  /**
   * Uitstellen tot een datum.
   *
   * De melding verdwijnt tot dan uit beeld, maar blijft bestaan: is de situatie
   * er dan nog steeds, dan komt hij vanzelf terug. Wegklikken zonder oplossen
   * is dus tijdelijk, en dat is de bedoeling.
   */
  app.post('/api/v1/alerts/:id/snooze', async (request) => {
    const gebruiker = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as { tot?: string; dagen?: number };

    let tot: string;
    if (typeof body.tot === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.tot)) {
      tot = `${body.tot} 00:00:00`;
    } else {
      const dagen = Number(body.dagen ?? 7);
      if (!Number.isFinite(dagen) || dagen < 1 || dagen > 365) {
        throw new ApiError(400, 'ongeldig', 'Uitstellen kan van één dag tot een jaar.');
      }
      tot = new Date(Date.now() + dagen * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    }

    const resultaat = request.core.handle.raw
      .prepare(
        `UPDATE alerts
            SET status = 'uitgesteld', snoozed_until = ?, acknowledged_by = ?,
                acknowledged_at = datetime('now')
          WHERE id = ? AND status IN ('open', 'bevestigd')`,
      )
      .run(tot, gebruiker.id, id);

    if (Number(resultaat.changes ?? 0) === 0) {
      throw new ApiError(404, 'niet_gevonden', 'Deze melding bestaat niet of is al afgehandeld.');
    }
    return { data: { id, status: 'uitgesteld', tot } };
  });

  /**
   * Handmatig sluiten.
   *
   * Bestaat de situatie nog, dan komt de melding bij de volgende controle
   * gewoon terug — met een nieuwe begindatum. Dat is geen hinder maar het punt:
   * een melding wegklikken lost niets op.
   */
  app.post('/api/v1/alerts/:id/resolve', async (request) => {
    const gebruiker = currentUser(request);
    const id = Number((request.params as { id: string }).id);

    const resultaat = request.core.handle.raw
      .prepare(
        `UPDATE alerts
            SET status = 'opgelost', acknowledged_by = ?, acknowledged_at = datetime('now')
          WHERE id = ? AND status != 'opgelost'`,
      )
      .run(gebruiker.id, id);

    if (Number(resultaat.changes ?? 0) === 0) {
      throw new ApiError(404, 'niet_gevonden', 'Deze melding bestaat niet of is al gesloten.');
    }
    return { data: { id, status: 'opgelost' } };
  });
}
