/** Endpoints voor pakketten en offertes (hoofdstuk 6.5). */
import type { FastifyInstance } from 'fastify';
import { ApiError, currentUser } from '../../server.ts';
import { bekijkVolgendNummer } from '../numbering/sequences.ts';
import { pricePackage } from './pricing.ts';
import {
  accepteerOfferte,
  herberekenOfferte,
  kiesOptie,
  laadRegels,
  maakOfferteVanPakket,
  OfferteFout,
  vervalVerlopenOffertes,
  verstuurOfferte,
  wijsAfOfferte,
} from './quotes.ts';

type Rij = Record<string, unknown>;

/** Vertaalt een OfferteFout naar een nette API-fout. */
function vang<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof OfferteFout) {
      throw new ApiError(error.code === 'niet_gevonden' ? 404 : 400, error.code, error.message);
    }
    throw error;
  }
}

export async function registerPackageRoutes(app: FastifyInstance): Promise<void> {
  /**
   * De pakketten met hun samenstelling en berekende prijs.
   *
   * De prijs staat niet in de database: hij volgt uit de regels en de
   * prijsmodus, en zou anders bij elke productprijswijziging verouderen.
   */
  app.get('/api/v1/packages/overview', async (request) => {
    const handle = request.core.handle;
    currentUser(request);

    const pakketten = handle.raw
      .prepare(
        `SELECT p.*, c.name AS categorie FROM packages p
    LEFT JOIN product_categories c ON c.id = p.category_id
        WHERE p.archived_at IS NULL
        ORDER BY p.sort_order, p.name`,
      )
      .all() as Rij[];

    const alleRegels = handle.raw
      .prepare(
        `SELECT i.*, pr.name AS product_naam, pr.sku, pr.unit, pr.vat_rate_bp,
                pr.purchase_price_cents, pr.sales_price_cents
           FROM package_items i
      LEFT JOIN products pr ON pr.id = i.product_id
          WHERE i.archived_at IS NULL
          ORDER BY i.sort_order, i.id`,
      )
      .all() as Rij[];

    return {
      data: pakketten.map((pakket) => {
        const regels = alleRegels.filter((regel) => regel.package_id === pakket.id);
        const prijs = pricePackage({
          pricingMode: String(pakket.pricing_mode) as 'sum' | 'fixed' | 'sum_with_margin',
          fixedPriceCents: pakket.fixed_price_cents as number | null,
          marginBp: Number(pakket.margin_bp ?? 0),
          vatMode: String(pakket.vat_mode) as 'incl' | 'excl',
          items: regels.map((regel) => ({
            description: String(regel.description ?? regel.product_naam ?? 'Regel'),
            quantity: Number(regel.quantity),
            unitPriceCents:
              Number(regel.unit_price_cents) > 0
                ? Number(regel.unit_price_cents)
                : Number(regel.sales_price_cents ?? 0),
            discountBp: Number(regel.discount_bp ?? 0),
            vatRateBp: Number(regel.vat_rate_bp ?? 2100),
            costPriceCents: Number(regel.purchase_price_cents ?? 0),
            isOptional: Number(regel.is_optional) === 1,
          })),
        });

        return {
          ...pakket,
          regels: regels.map((regel) => ({
            ...regel,
            naam: String(regel.description ?? regel.product_naam ?? 'Regel'),
          })),
          prijs: {
            subtotaalCents: prijs.totalExclVatCents,
            btwCents: prijs.vatCents,
            totaalCents: prijs.totalInclVatCents,
            kostprijsCents: prijs.costCents,
            margeCents: prijs.marginCents,
            margeBp: prijs.marginBp,
          },
        };
      }),
    };
  });

  /** Het nummer dat de volgende offerte krijgt. */
  app.get('/api/v1/quotes/next-number', async (request) => {
    currentUser(request);
    return { data: { nummer: bekijkVolgendNummer(request.core.handle, 'package_quotes') } };
  });

  /** Een offerte samenstellen uit een pakket. */
  app.post('/api/v1/quotes/from-package', async (request, reply) => {
    const gebruiker = currentUser(request);
    const body = (request.body ?? {}) as Rij;

    const packageId = Number(body.packageId);
    if (!Number.isInteger(packageId) || packageId <= 0) {
      throw new ApiError(400, 'onvolledig', 'Kies een pakket om de offerte op te baseren.');
    }

    const id = vang(() =>
      maakOfferteVanPakket(
        request.core.handle,
        {
          packageId,
          organizationId: getal(body.organizationId),
          contactId: getal(body.contactId),
          projectId: getal(body.projectId),
          opportunityId: getal(body.opportunityId),
          ownerUserId: getal(body.ownerUserId),
          aantal: body.aantal === undefined ? 1 : Number(body.aantal),
          notes: typeof body.notes === 'string' ? body.notes : null,
        },
        gebruiker.id,
      ),
    );

    return reply.code(201).send({ data: { quoteId: id } });
  });

  /** Eén offerte met haar regels en totalen. */
  app.get('/api/v1/quotes/:id', async (request) => {
    currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const handle = request.core.handle;

    const offerte = handle.raw
      .prepare(
        `SELECT q.*, o.name AS klant, c.first_name, c.last_name, pr.name AS project,
                pk.name AS pakket, u.name AS eigenaar
           FROM package_quotes q
      LEFT JOIN organizations o ON o.id = q.organization_id
      LEFT JOIN contacts c ON c.id = q.contact_id
      LEFT JOIN projects pr ON pr.id = q.project_id
      LEFT JOIN packages pk ON pk.id = q.package_id
      LEFT JOIN users u ON u.id = q.owner_user_id
          WHERE q.id = ?`,
      )
      .get(id) as Rij | undefined;

    if (!offerte) throw new ApiError(404, 'niet_gevonden', 'Deze offerte bestaat niet.');

    return { data: { offerte, regels: laadRegels(handle, id) } };
  });

  /** Een optionele regel aan- of uitzetten. */
  app.post('/api/v1/quotes/:id/lines/:lineId/select', async (request) => {
    currentUser(request);
    const params = request.params as { id: string; lineId: string };
    const body = (request.body ?? {}) as { gekozen?: boolean };

    return {
      data: vang(() =>
        kiesOptie(
          request.core.handle,
          Number(params.id),
          Number(params.lineId),
          body.gekozen !== false,
        ),
      ),
    };
  });

  /** Opnieuw doorrekenen, bijvoorbeeld na het wijzigen van regels. */
  app.post('/api/v1/quotes/:id/recalculate', async (request) => {
    currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const totalen = herberekenOfferte(request.core.handle, id);
    if (!totalen) throw new ApiError(404, 'niet_gevonden', 'Deze offerte bestaat niet.');
    return { data: totalen };
  });

  app.post('/api/v1/quotes/:id/send', async (request) => {
    const gebruiker = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as { geldigTot?: string };

    return {
      data: vang(() =>
        verstuurOfferte(request.core.handle, id, gebruiker.id, body.geldigTot ?? null),
      ),
    };
  });

  app.post('/api/v1/quotes/:id/accept', async (request) => {
    const gebruiker = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    return { data: vang(() => accepteerOfferte(request.core.handle, id, gebruiker.id)) };
  });

  app.post('/api/v1/quotes/:id/decline', async (request) => {
    const gebruiker = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const body = (request.body ?? {}) as { redenId?: number | null; notitie?: string };

    return {
      data: vang(() =>
        wijsAfOfferte(
          request.core.handle,
          id,
          getal(body.redenId),
          body.notitie ?? null,
          gebruiker.id,
        ),
      ),
    };
  });

  /** Verlopen offertes op "vervallen" zetten. */
  app.post('/api/v1/quotes/expire', async (request) => {
    currentUser(request);
    return { data: { vervallen: vervalVerlopenOffertes(request.core.handle) } };
  });
}

/** Een optioneel id uit het verzoek; alles wat geen geheel getal is wordt null. */
function getal(waarde: unknown): number | null {
  if (waarde === undefined || waarde === null || waarde === '') return null;
  const getal = Number(waarde);
  return Number.isInteger(getal) && getal > 0 ? getal : null;
}
