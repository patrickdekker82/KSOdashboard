/** Endpoints voor e-mail en opvolging (hoofdstuk 9). */
import type { FastifyInstance } from 'fastify';
import { ApiError, currentUser } from '../../server.ts';
import {
  laadSjablonen,
  MailFout,
  markeerVerstuurd,
  sjabloonPlaatshouders,
  stelBerichtOp,
  vindOntvangers,
} from './compose.ts';
import { bouwContext, ONDERWERPEN } from './context.ts';
import {
  bellijst,
  markeerBelregel,
  OpvolgFout,
  rondAf,
  werklijst,
} from '../followup/queries.ts';

type Rij = Record<string, unknown>;

/** Vertaalt een module-fout naar een nette API-fout. */
function vang<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof MailFout || error instanceof OpvolgFout) {
      throw new ApiError(error.code === 'niet_gevonden' ? 404 : 400, error.code, error.message);
    }
    throw error;
  }
}

export async function registerEmailRoutes(app: FastifyInstance): Promise<void> {
  /** De sjablonen, met de plaatshouders die ze gebruiken. */
  app.get('/api/v1/email/templates', async (request) => {
    currentUser(request);
    const entiteit = (request.query as Rij).entity;
    const rijen = laadSjablonen(
      request.core.handle,
      typeof entiteit === 'string' && entiteit !== '' ? entiteit : undefined,
    );

    return {
      data: rijen.map((rij) => ({ ...rij, plaatshouders: sjabloonPlaatshouders(rij) })),
    };
  });

  /** Welke plaatshouders er bij een record te vullen zijn, en met wat. */
  app.get('/api/v1/email/context', async (request) => {
    const gebruiker = currentUser(request);
    const query = request.query as Rij;
    const entiteit = String(query.entity ?? '');
    const recordId = Number(query.recordId);

    if (!ONDERWERPEN.has(entiteit) || !Number.isInteger(recordId)) {
      throw new ApiError(400, 'onvolledig', 'Geef een geldig onderwerp en recordnummer op.');
    }

    const context = bouwContext(request.core.handle, entiteit, recordId, gebruiker.id);
    const plat: Record<string, string> = {};
    for (const [groep, waarden] of context) {
      for (const [veld, waarde] of waarden) {
        if (waarde !== null && waarde !== '') plat[`${groep}.${veld}`] = String(waarde);
      }
    }

    return {
      data: {
        waarden: plat,
        ontvangers: vindOntvangers(request.core.handle, entiteit, recordId),
      },
    };
  });

  /**
   * Een bericht opstellen.
   *
   * Levert de .eml terug; de schil schrijft die weg en opent hem in de
   * mailclient die er al staat. Er gaat hier niets zelf de deur uit.
   */
  app.post('/api/v1/email/compose', async (request, reply) => {
    const gebruiker = currentUser(request);
    const body = (request.body ?? {}) as Rij;

    const bericht = vang(() =>
      stelBerichtOp(
        request.core.handle,
        {
          entiteit: String(body.entity ?? ''),
          recordId: Number(body.recordId),
          templateId: body.templateId === undefined ? null : Number(body.templateId),
          onderwerp: typeof body.onderwerp === 'string' ? body.onderwerp : undefined,
          bodyHtml: typeof body.bodyHtml === 'string' ? body.bodyHtml : undefined,
          aan: Array.isArray(body.aan) ? (body.aan as Array<{ adres: string }>) : undefined,
          cc: Array.isArray(body.cc) ? (body.cc as Array<{ adres: string }>) : undefined,
        },
        gebruiker.id,
      ),
    );

    return reply.code(201).send({ data: bericht });
  });

  /** Het bericht is daadwerkelijk verstuurd; de gebruiker bevestigt dat. */
  app.post('/api/v1/email/:id/sent', async (request) => {
    currentUser(request);
    const id = Number((request.params as { id: string }).id);
    vang(() => markeerVerstuurd(request.core.handle, id));
    return { data: { id, status: 'verstuurd' } };
  });

  /** De berichten bij één record, voor de tijdlijn. */
  app.get('/api/v1/email/messages', async (request) => {
    currentUser(request);
    const query = request.query as Rij;
    const rijen = request.core.handle.raw
      .prepare(
        `SELECT m.*, u.name AS door FROM email_messages m
      LEFT JOIN email_message_links l ON l.message_id = m.id
      LEFT JOIN users u ON u.id = m.created_by
          WHERE l.entity_key = ? AND l.record_id = ?
          ORDER BY m.created_at DESC`,
      )
      .all(String(query.entity ?? ''), Number(query.recordId)) as Rij[];
    return { data: rijen };
  });

  // --- opvolging ------------------------------------------------------------

  /** Wat er voor mij te doen staat. */
  app.get('/api/v1/followup/mine', async (request) => {
    const gebruiker = currentUser(request);
    const query = request.query as Rij;
    const gevraagd = query.userId === undefined ? gebruiker.id : Number(query.userId);

    // Andermans lijst bekijken mag, maar alleen als manager: een takenlijst
    // zegt veel over hoe iemands week eruitziet.
    const doelwit =
      gevraagd === gebruiker.id || gebruiker.role === 'manager' || gebruiker.role === 'admin'
        ? gevraagd
        : gebruiker.id;

    return { data: werklijst(request.core.handle, doelwit), meta: { userId: doelwit } };
  });

  /** Een activiteit afronden, eventueel met meteen een vervolgactie. */
  app.post('/api/v1/activities/:id/complete', async (request) => {
    const gebruiker = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as Rij;

    const vervolg =
      body.vervolg && typeof body.vervolg === 'object'
        ? (body.vervolg as { type?: string; subject?: string; dueAt?: string; assignedUserId?: number })
        : null;

    return {
      data: vang(() =>
        rondAf(
          request.core.handle,
          id,
          {
            uitkomst: typeof body.uitkomst === 'string' ? body.uitkomst : null,
            outcomeId: body.outcomeId === undefined ? null : Number(body.outcomeId),
            vervolg: vervolg
              ? {
                  type: String(vervolg.type ?? 'taak'),
                  subject: String(vervolg.subject ?? ''),
                  dueAt: String(vervolg.dueAt ?? ''),
                  assignedUserId:
                    vervolg.assignedUserId === undefined ? null : Number(vervolg.assignedUserId),
                }
              : null,
          },
          gebruiker.id,
        ),
      ),
    };
  });

  /** De leden van een bellijst. */
  app.get('/api/v1/call-lists/:id/members', async (request) => {
    currentUser(request);
    const id = Number((request.params as { id: string }).id);
    return { data: bellijst(request.core.handle, id) };
  });

  /** Een regel van de bellijst afvinken. */
  app.post('/api/v1/call-lists/:id/members/mark', async (request) => {
    currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as Rij;

    vang(() =>
      markeerBelregel(
        request.core.handle,
        id,
        String(body.entity ?? ''),
        Number(body.recordId),
        body.gedaan !== false,
        typeof body.notitie === 'string' ? body.notitie : null,
      ),
    );

    return { data: { lijstId: id, recordId: Number(body.recordId) } };
  });
}
