/** CRM-endpoints: zoeken, dubbelen, samenvoegen, tijdlijn, tags en AVG. */
import type { FastifyInstance } from 'fastify';
import { ApiError, currentUser, requireRole } from '../../server.ts';
import { ENTITY_BY_KEY } from '../crud/registry.ts';
import { vindDubbelen, type Kandidaat } from './duplicates.ts';
import { SamenvoegFout, voegSamen } from './merge.ts';
import { zoek, volledigeNaam } from './search.ts';
import { tijdlijnVoor } from './timeline.ts';
import { anonimiseer, inzagedossier, verlopenBewaartermijn } from './gdpr.ts';

type Rij = Record<string, unknown>;

/** Entiteiten waarop dubbelendetectie en samenvoegen werken. */
const SAMENVOEGBAAR = new Set(['organizations', 'contacts']);

export async function registerCrmRoutes(app: FastifyInstance): Promise<void> {
  // --- zoeken ---------------------------------------------------------------
  app.get('/api/v1/search', async (request) => {
    const query = request.query as Record<string, unknown>;
    const invoer = String(query.q ?? '');
    const limiet = Math.min(20, Math.max(1, Number(query.limit ?? 8)));
    return { data: zoek(request.core.handle, invoer, limiet) };
  });

  // --- dubbelen -------------------------------------------------------------
  app.get('/api/v1/duplicates', async (request) => {
    const query = request.query as Record<string, unknown>;
    const entiteit = String(query.entity ?? 'organizations');
    if (!SAMENVOEGBAAR.has(entiteit)) {
      throw new ApiError(
        400,
        'niet_ondersteund',
        'Dubbelendetectie werkt op klanten en contactpersonen.',
      );
    }

    const handle = request.core.handle;
    // Een bovengrens: het vergelijken is O(n²), en boven een paar duizend
    // records is een lijst met vermoedens toch niet meer werkbaar.
    const maximum = Math.min(2000, Math.max(50, Number(query.max ?? 1000)));

    const kandidaten: Kandidaat[] =
      entiteit === 'organizations'
        ? (
            handle.raw
              .prepare(
                `SELECT id, name, kvk_number, postcode, address_number, email
                   FROM organizations WHERE archived_at IS NULL ORDER BY id LIMIT ?`,
              )
              .all(maximum) as Rij[]
          ).map((rij) => ({
            id: Number(rij.id),
            naam: String(rij.name),
            kvk: (rij.kvk_number as string | null) ?? null,
            postcode: (rij.postcode as string | null) ?? null,
            huisnummer: (rij.address_number as string | null) ?? null,
            email: (rij.email as string | null) ?? null,
          }))
        : (
            handle.raw
              .prepare(
                `SELECT id, first_name, infix, last_name, email
                   FROM contacts WHERE archived_at IS NULL AND anonymised_at IS NULL
                  ORDER BY id LIMIT ?`,
              )
              .all(maximum) as Rij[]
          ).map((rij) => ({
            id: Number(rij.id),
            naam: volledigeNaam(rij),
            kvk: null,
            postcode: null,
            huisnummer: null,
            email: (rij.email as string | null) ?? null,
          }));

    const drempel = query.threshold === undefined ? undefined : Number(query.threshold);
    const paren = vindDubbelen(kandidaten, drempel === undefined ? {} : { naamDrempel: drempel });

    // De records zelf meesturen, zodat het scherm ze naast elkaar kan zetten.
    const gebruikteIds = [...new Set(paren.flatMap((paar) => [paar.a, paar.b]))];
    const records =
      gebruikteIds.length === 0
        ? []
        : (handle.raw
            .prepare(
              `SELECT * FROM ${entiteit} WHERE id IN (${gebruikteIds.map(() => '?').join(', ')})`,
            )
            .all(...(gebruikteIds as never[])) as Rij[]);

    return {
      data: { paren, records },
      meta: { entiteit, onderzocht: kandidaten.length, gevonden: paren.length },
    };
  });

  // --- samenvoegen ----------------------------------------------------------
  app.post('/api/v1/:entity/:id/merge', async (request) => {
    const params = request.params as { entity: string; id: string };
    const entiteit = params.entity;
    if (!SAMENVOEGBAAR.has(entiteit)) {
      throw new ApiError(
        400,
        'niet_ondersteund',
        'Samenvoegen werkt op klanten en contactpersonen.',
      );
    }

    // Samenvoegen archiveert een record en verplaatst alles eronder; dat is
    // geen dagelijkse handeling voor een gewone gebruiker.
    const user = requireRole(request, 'manager');
    const body = (request.body ?? {}) as { verliezerId?: number; waarden?: Record<string, unknown> };
    const verliezerId = Number(body.verliezerId);
    if (!Number.isInteger(verliezerId) || verliezerId <= 0) {
      throw new ApiError(400, 'onvolledig', 'Geef aan welk record vervalt.');
    }

    const definitie = ENTITY_BY_KEY.get(entiteit)!;

    try {
      const resultaat = voegSamen(
        request.core.handle,
        {
          entiteit: entiteit as 'organizations' | 'contacts',
          winnaarId: Number(params.id),
          verliezerId,
          waarden: body.waarden,
        },
        user.id,
        definitie.writable,
      );
      return { data: resultaat };
    } catch (error) {
      if (error instanceof SamenvoegFout) {
        throw new ApiError(400, 'samenvoegen_mislukt', error.message);
      }
      throw error;
    }
  });

  // --- tijdlijn -------------------------------------------------------------
  app.get('/api/v1/:entity/:id/timeline', async (request) => {
    const params = request.params as { entity: string; id: string };
    if (!ENTITY_BY_KEY.has(params.entity)) {
      throw new ApiError(404, 'onbekende_entiteit', `Onbekende entiteit: "${params.entity}".`);
    }
    const limiet = Math.min(200, Math.max(1, Number((request.query as Rij).limit ?? 100)));
    return {
      data: tijdlijnVoor(request.core.handle, params.entity, Number(params.id), limiet),
    };
  });

  /** Een activiteit vastleggen op een record, in één handeling. */
  app.post('/api/v1/:entity/:id/activities', async (request, reply) => {
    const params = request.params as { entity: string; id: string };
    if (!ENTITY_BY_KEY.has(params.entity)) {
      throw new ApiError(404, 'onbekende_entiteit', `Onbekende entiteit: "${params.entity}".`);
    }
    const user = currentUser(request);
    const body = (request.body ?? {}) as Rij;
    const onderwerp = String(body.subject ?? '').trim();
    if (onderwerp === '') {
      throw new ApiError(400, 'onvolledig', 'Een activiteit heeft een onderwerp nodig.');
    }

    const handle = request.core.handle;
    handle.raw.exec('BEGIN');
    try {
      const resultaat = handle.raw
        .prepare(
          `INSERT INTO activities
             (type, subject, body, status, priority, due_at, assigned_user_id, completed_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          String(body.type ?? 'notitie'),
          onderwerp,
          (body.body as string) ?? null,
          String(body.status ?? 'open'),
          String(body.priority ?? 'normaal'),
          (body.due_at as string) ?? null,
          body.assigned_user_id === undefined ? user.id : Number(body.assigned_user_id),
          (body.completed_at as string) ?? null,
          user.id,
          user.id,
        );

      const activiteitId = Number(resultaat.lastInsertRowid);
      handle.raw
        .prepare(
          'INSERT INTO activity_links (activity_id, entity_key, record_id, is_primary) VALUES (?, ?, ?, 1)',
        )
        .run(activiteitId, params.entity, Number(params.id));

      // Op entiteiten die het bijhouden, het moment van laatste contact meeschrijven.
      if (params.entity === 'opportunities') {
        handle.raw
          .prepare("UPDATE opportunities SET last_activity_at = datetime('now') WHERE id = ?")
          .run(Number(params.id));
      }

      handle.raw.exec('COMMIT');
      const activiteit = handle.raw.prepare('SELECT * FROM activities WHERE id = ?').get(activiteitId);
      return reply.code(201).send({ data: activiteit });
    } catch (error) {
      handle.raw.exec('ROLLBACK');
      throw error;
    }
  });

  // --- tags -----------------------------------------------------------------
  app.get('/api/v1/:entity/:id/tags', async (request) => {
    const params = request.params as { entity: string; id: string };
    const rijen = request.core.handle.raw
      .prepare(
        `SELECT t.id, t.name, t.color FROM tags t
           JOIN taggables g ON g.tag_id = t.id
          WHERE g.entity_key = ? AND g.record_id = ? AND t.archived_at IS NULL
          ORDER BY t.name`,
      )
      .all(params.entity, Number(params.id)) as Rij[];
    return { data: rijen };
  });

  app.post('/api/v1/:entity/:id/tags', async (request) => {
    const params = request.params as { entity: string; id: string };
    currentUser(request);
    const naam = String((request.body as { name?: string } | undefined)?.name ?? '').trim();
    if (naam === '') throw new ApiError(400, 'onvolledig', 'Geef een naam voor het label.');

    const handle = request.core.handle;
    // Labels worden gedeeld: bestaat hij al, dan hergebruiken we hem.
    const bestaand = handle.raw
      .prepare('SELECT id FROM tags WHERE name = ? AND (entity_scope IS NULL OR entity_scope = ?)')
      .get(naam, params.entity) as { id: number } | undefined;

    const tagId =
      bestaand?.id ??
      Number(
        handle.raw.prepare('INSERT INTO tags (name, entity_scope) VALUES (?, ?)').run(naam, params.entity)
          .lastInsertRowid,
      );

    handle.raw
      .prepare(
        'INSERT OR IGNORE INTO taggables (tag_id, entity_key, record_id) VALUES (?, ?, ?)',
      )
      .run(tagId, params.entity, Number(params.id));

    return { data: { id: tagId, name: naam } };
  });

  app.delete('/api/v1/:entity/:id/tags/:tagId', async (request) => {
    const params = request.params as { entity: string; id: string; tagId: string };
    currentUser(request);
    request.core.handle.raw
      .prepare('DELETE FROM taggables WHERE tag_id = ? AND entity_key = ? AND record_id = ?')
      .run(Number(params.tagId), params.entity, Number(params.id));
    return { verwijderd: true };
  });

  // --- AVG ------------------------------------------------------------------
  app.get('/api/v1/contacts/:id/gdpr-export', async (request) => {
    // Een inzagedossier bevat alles over één persoon; dat is niets voor een
    // gewone gebruiker om zomaar op te vragen.
    requireRole(request, 'manager');
    const dossier = inzagedossier(request.core.handle, Number((request.params as { id: string }).id));
    if (!dossier) throw new ApiError(404, 'niet_gevonden', 'Deze contactpersoon bestaat niet.');
    return { data: dossier };
  });

  app.post('/api/v1/contacts/:id/anonymise', async (request) => {
    const user = requireRole(request, 'manager');
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as { bevestiging?: string };

    // Anonimiseren is onomkeerbaar, dus met dezelfde dubbele bevestiging als
    // het definitief verwijderen van een veld.
    if (body.bevestiging !== 'ANONIMISEREN') {
      throw new ApiError(
        400,
        'bevestiging_onjuist',
        'Typ ANONIMISEREN over om te bevestigen. De naam en contactgegevens worden ' +
          'overschreven; offertes en kansen blijven bestaan.',
      );
    }

    const resultaat = anonimiseer(request.core.handle, id, user.id);
    if (!resultaat) throw new ApiError(404, 'niet_gevonden', 'Deze contactpersoon bestaat niet.');
    return { data: resultaat };
  });

  app.get('/api/v1/gdpr/retention', async (request) => {
    requireRole(request, 'manager');
    const dagen = Number((request.query as Rij).days ?? 730);
    return { data: verlopenBewaartermijn(request.core.handle, dagen), meta: { dagen } };
  });
}
