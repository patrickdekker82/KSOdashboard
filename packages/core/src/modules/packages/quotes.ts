/**
 * Offertes uit duurzaamheidspakketten (hoofdstuk 6.5).
 *
 * Een offerte begint als kopie van een pakket. Dat is bewust een kopie en geen
 * verwijzing: gaat de prijs van een zonnepaneel volgende maand omhoog, dan
 * verandert een offerte die de klant al heeft gezien niet met terugwerkende
 * kracht mee. Wat er op papier stond, blijft staan.
 *
 * Bedragen worden nergens door een gebruiker ingetikt: subtotaal, korting, btw
 * en totaal komen uit `pricePackage`, en die functie draait opnieuw bij elke
 * wijziging aan de offerte of aan een regel. Dat is dezelfde afspraak als bij
 * kansen, en om dezelfde reden: één plek waar gerekend wordt.
 */
import { toIsoDate } from '@showroom/shared';
import type { PackageItemInput } from '@showroom/shared';
import type { DatabaseHandle } from '../../db/client.ts';
import { volgendNummer } from '../numbering/sequences.ts';
import { pricePackage } from './pricing.ts';

type Rij = Record<string, unknown>;

export class OfferteFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OfferteFout';
    this.code = code;
  }
}

/** Hoe lang een offerte standaard geldig is. */
const GELDIGHEID_DAGEN = 30;

export type OfferteInvoer = {
  packageId: number;
  organizationId?: number | null;
  contactId?: number | null;
  projectId?: number | null;
  opportunityId?: number | null;
  ownerUserId?: number | null;
  /** Aantal keer het pakket, bijvoorbeeld voor twaalf woningen. */
  aantal?: number;
  notes?: string | null;
};

/**
 * Maakt een offerte op basis van een pakket.
 *
 * Optionele pakketregels komen mee als optioneel én uitgevinkt: de klant kiest
 * ze er zelf bij. Zouden ze aan staan, dan is de eerste prijs die de klant ziet
 * hoger dan het pakket belooft.
 */
export function maakOfferteVanPakket(
  handle: DatabaseHandle,
  invoer: OfferteInvoer,
  gebruikerId: number,
  nu = new Date(),
): number {
  const pakket = handle.raw
    .prepare('SELECT * FROM packages WHERE id = ? AND archived_at IS NULL')
    .get(invoer.packageId) as Rij | undefined;
  if (!pakket) throw new OfferteFout('niet_gevonden', 'Dit pakket bestaat niet.');

  const aantal = invoer.aantal ?? 1;
  if (!Number.isFinite(aantal) || aantal <= 0) {
    throw new OfferteFout('ongeldig_aantal', 'Het aantal moet groter dan nul zijn.');
  }

  const regels = handle.raw
    .prepare(
      `SELECT i.*, p.name AS product_naam, p.unit, p.vat_rate_bp, p.purchase_price_cents,
              p.sales_price_cents
         FROM package_items i
    LEFT JOIN products p ON p.id = i.product_id
        WHERE i.package_id = ? AND i.archived_at IS NULL
        ORDER BY i.sort_order, i.id`,
    )
    .all(invoer.packageId) as Rij[];

  if (regels.length === 0) {
    throw new OfferteFout('leeg_pakket', 'Dit pakket heeft geen regels; er valt niets te offreren.');
  }

  handle.raw.exec('BEGIN');
  try {
    const nummer = volgendNummer(handle, 'package_quotes', nu);
    const geldigTot = toIsoDate(new Date(nu.getTime() + GELDIGHEID_DAGEN * 86_400_000));

    const offerte = handle.raw
      .prepare(
        `INSERT INTO package_quotes
           (number, organization_id, contact_id, project_id, opportunity_id, package_id,
            owner_user_id, status, valid_until, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'concept', ?, ?, ?, ?)`,
      )
      .run(
        nummer,
        invoer.organizationId ?? null,
        invoer.contactId ?? null,
        invoer.projectId ?? null,
        invoer.opportunityId ?? null,
        invoer.packageId,
        invoer.ownerUserId ?? gebruikerId,
        geldigTot,
        invoer.notes ?? (pakket.default_terms as string | null) ?? null,
        gebruikerId,
        gebruikerId,
      );

    const offerteId = Number(offerte.lastInsertRowid);

    const invoegen = handle.raw.prepare(
      `INSERT INTO package_quote_lines
         (quote_id, product_id, description, quantity, unit, unit_price_cents, discount_bp,
          vat_rate_bp, amount_cents, cost_price_cents, is_optional, is_selected, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    );

    regels.forEach((regel, index) => {
      const optioneel = Number(regel.is_optional) === 1;
      // De prijs uit de pakketregel wint van die van het product: een pakket
      // mag een eigen prijsafspraak hebben.
      const stuksprijs =
        Number(regel.unit_price_cents) > 0
          ? Number(regel.unit_price_cents)
          : Number(regel.sales_price_cents ?? 0);

      invoegen.run(
        offerteId,
        regel.product_id === null ? null : Number(regel.product_id),
        String(regel.description ?? regel.product_naam ?? 'Regel'),
        Number(regel.quantity) * aantal,
        (regel.unit as string | null) ?? null,
        stuksprijs,
        Number(regel.discount_bp ?? 0),
        Number(regel.vat_rate_bp ?? 2100),
        Number(regel.purchase_price_cents ?? 0),
        optioneel ? 1 : 0,
        // Optioneel komt uitgevinkt binnen: de klant kiest het er zelf bij.
        optioneel ? 0 : 1,
        index,
      );
    });

    handle.raw.exec('COMMIT');
    herberekenOfferte(handle, offerteId);
    return offerteId;
  } catch (error) {
    handle.raw.exec('ROLLBACK');
    throw error;
  }
}

export type OfferteTotalen = {
  quoteId: number;
  subtotalCents: number;
  discountCents: number;
  vatCents: number;
  totalCents: number;
  costCents: number;
  marginCents: number;
  marginBp: number;
  regels: number;
};

/**
 * Rekent de offerte opnieuw door en schrijft de bedragen weg.
 *
 * De prijsmodus van het pakket blijft gelden: staat er een vaste prijs op, dan
 * wordt het verschil evenredig over de regels verdeeld zodat de btw per tarief
 * blijft kloppen. Zonder pakket — een offerte die met de hand is samengesteld —
 * telt de som van de regels.
 */
export function herberekenOfferte(
  handle: DatabaseHandle,
  quoteId: number,
): OfferteTotalen | null {
  const offerte = handle.raw
    .prepare('SELECT * FROM package_quotes WHERE id = ?')
    .get(quoteId) as Rij | undefined;
  if (!offerte) return null;

  const pakketId = typeof offerte.package_id === 'number' ? offerte.package_id : null;
  const pakket =
    pakketId === null
      ? null
      : ((handle.raw.prepare('SELECT * FROM packages WHERE id = ?').get(pakketId) as
          | Rij
          | undefined) ?? null);

  const rijen = handle.raw
    .prepare('SELECT * FROM package_quote_lines WHERE quote_id = ? ORDER BY sort_order, id')
    .all(quoteId) as Rij[];

  const items: Array<PackageItemInput & { id: number }> = rijen.map((rij) => ({
    id: Number(rij.id),
    description: String(rij.description),
    quantity: Number(rij.quantity),
    unitPriceCents: Number(rij.unit_price_cents),
    discountBp: Number(rij.discount_bp),
    vatRateBp: Number(rij.vat_rate_bp),
    costPriceCents: Number(rij.cost_price_cents),
    isOptional: Number(rij.is_optional) === 1,
    isSelected: Number(rij.is_selected) === 1,
  }));

  const prijs = pricePackage({
    pricingMode: (pakket?.pricing_mode as 'sum' | 'fixed' | 'sum_with_margin') ?? 'sum',
    fixedPriceCents: pakket ? (pakket.fixed_price_cents as number | null) : null,
    marginBp: pakket ? Number(pakket.margin_bp ?? 0) : 0,
    vatMode: (pakket?.vat_mode as 'incl' | 'excl') ?? 'excl',
    items,
  });

  // De bedragen terug op de regels. `pricePackage` levert alleen de meegetelde
  // regels; een uitgevinkte optie krijgt nul.
  const meegeteld = items.filter((item) => !item.isOptional || item.isSelected === true);
  const bijwerken = handle.raw.prepare(
    'UPDATE package_quote_lines SET amount_cents = ? WHERE id = ?',
  );
  const opNul = handle.raw.prepare(
    'UPDATE package_quote_lines SET amount_cents = 0 WHERE quote_id = ? AND is_optional = 1 AND is_selected = 0',
  );

  prijs.lines.forEach((regel, index) => {
    const item = meegeteld[index];
    if (item) bijwerken.run(regel.amountCents, item.id);
  });
  opNul.run(quoteId);

  handle.raw
    .prepare(
      `UPDATE package_quotes
          SET subtotal_cents = ?, discount_cents = ?, vat_cents = ?, total_cents = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .run(
      prijs.totalExclVatCents,
      prijs.discountCents,
      prijs.vatCents,
      prijs.totalInclVatCents,
      quoteId,
    );

  return {
    quoteId,
    subtotalCents: prijs.totalExclVatCents,
    discountCents: prijs.discountCents,
    vatCents: prijs.vatCents,
    totalCents: prijs.totalInclVatCents,
    costCents: prijs.costCents,
    marginCents: prijs.marginCents,
    marginBp: prijs.marginBp,
    regels: prijs.lines.length,
  };
}

/** Herberekent de offerte waar een regel bij hoort. */
export function herberekenViaRegel(handle: DatabaseHandle, regel: Rij | null): void {
  const quoteId = regel?.quote_id;
  if (typeof quoteId === 'number') herberekenOfferte(handle, quoteId);
}

/** Zet een optionele regel aan of uit en rekent opnieuw door. */
export function kiesOptie(
  handle: DatabaseHandle,
  quoteId: number,
  lineId: number,
  gekozen: boolean,
): OfferteTotalen {
  const regel = handle.raw
    .prepare('SELECT * FROM package_quote_lines WHERE id = ? AND quote_id = ?')
    .get(lineId, quoteId) as Rij | undefined;
  if (!regel) throw new OfferteFout('niet_gevonden', 'Deze regel hoort niet bij deze offerte.');

  if (Number(regel.is_optional) !== 1) {
    throw new OfferteFout(
      'niet_optioneel',
      'Deze regel hoort bij het pakket en kan niet worden weggelaten. Verwijder hem als hij er echt niet in hoort.',
    );
  }

  handle.raw
    .prepare('UPDATE package_quote_lines SET is_selected = ? WHERE id = ?')
    .run(gekozen ? 1 : 0, lineId);

  return herberekenOfferte(handle, quoteId)!;
}

// --- statusstroom ----------------------------------------------------------

/** De statussen die een offerte kan hebben, in de volgorde waarin ze komen. */
export const STATUSSEN = ['concept', 'verstuurd', 'geaccepteerd', 'afgewezen', 'vervallen'] as const;
export type Offertestatus = (typeof STATUSSEN)[number];

function laadOfferte(handle: DatabaseHandle, quoteId: number): Rij {
  const rij = handle.raw
    .prepare('SELECT * FROM package_quotes WHERE id = ? AND archived_at IS NULL')
    .get(quoteId) as Rij | undefined;
  if (!rij) throw new OfferteFout('niet_gevonden', 'Deze offerte bestaat niet.');
  return rij;
}

/**
 * Versturen: de offerte gaat op slot voor prijswijzigingen.
 *
 * Niet technisch — de regels blijven bewerkbaar — maar administratief: vanaf nu
 * telt hij mee in de rapportage en in de signalering "offerte zonder reactie".
 */
export function verstuurOfferte(
  handle: DatabaseHandle,
  quoteId: number,
  gebruikerId: number,
  geldigTot?: string | null,
  nu = new Date(),
): { quoteId: number; status: Offertestatus; validUntil: string } {
  const offerte = laadOfferte(handle, quoteId);
  const status = String(offerte.status);

  if (status !== 'concept') {
    throw new OfferteFout(
      'al_verstuurd',
      `Deze offerte staat op "${status}" en kan niet opnieuw worden verstuurd.`,
    );
  }
  if (Number(offerte.total_cents) <= 0) {
    throw new OfferteFout(
      'geen_bedrag',
      'Deze offerte komt op nul euro uit. Controleer de regels voordat u hem verstuurt.',
    );
  }

  const tot =
    geldigTot ?? toIsoDate(new Date(nu.getTime() + GELDIGHEID_DAGEN * 86_400_000));

  handle.raw
    .prepare(
      `UPDATE package_quotes
          SET status = 'verstuurd', sent_at = ?, valid_until = ?,
              updated_at = datetime('now'), updated_by = ?
        WHERE id = ?`,
    )
    .run(nu.toISOString().slice(0, 19).replace('T', ' '), tot, gebruikerId, quoteId);

  return { quoteId, status: 'verstuurd', validUntil: tot };
}

/** Geaccepteerd. */
export function accepteerOfferte(
  handle: DatabaseHandle,
  quoteId: number,
  gebruikerId: number,
  nu = new Date(),
): { quoteId: number; status: Offertestatus } {
  const offerte = laadOfferte(handle, quoteId);
  if (String(offerte.status) !== 'verstuurd') {
    throw new OfferteFout(
      'niet_verstuurd',
      'Alleen een verstuurde offerte kan worden geaccepteerd.',
    );
  }

  handle.raw
    .prepare(
      `UPDATE package_quotes
          SET status = 'geaccepteerd', decided_at = ?, updated_at = datetime('now'), updated_by = ?
        WHERE id = ?`,
    )
    .run(toIsoDate(nu), gebruikerId, quoteId);

  return { quoteId, status: 'geaccepteerd' };
}

/** Afgewezen, met een reden. Zonder reden zegt het verliesrapport later niets. */
export function wijsAfOfferte(
  handle: DatabaseHandle,
  quoteId: number,
  redenId: number | null,
  notitie: string | null,
  gebruikerId: number,
  nu = new Date(),
): { quoteId: number; status: Offertestatus } {
  const offerte = laadOfferte(handle, quoteId);
  if (String(offerte.status) !== 'verstuurd') {
    throw new OfferteFout('niet_verstuurd', 'Alleen een verstuurde offerte kan worden afgewezen.');
  }
  if (redenId === null && (notitie === null || notitie.trim() === '')) {
    throw new OfferteFout(
      'reden_verplicht',
      'Kies een reden of licht in het kort toe waarom deze offerte niet doorgaat.',
    );
  }

  handle.raw
    .prepare(
      `UPDATE package_quotes
          SET status = 'afgewezen', decided_at = ?, decline_reason_id = ?,
              internal_notes = COALESCE(?, internal_notes),
              updated_at = datetime('now'), updated_by = ?
        WHERE id = ?`,
    )
    .run(toIsoDate(nu), redenId, notitie, gebruikerId, quoteId);

  return { quoteId, status: 'afgewezen' };
}

/**
 * Zet verstuurde offertes waarvan de geldigheid voorbij is op "vervallen".
 *
 * Wordt door de signaleringscontrole aangeroepen. Zonder dit blijft een offerte
 * van vorig jaar in de trechter staan alsof er nog antwoord op kan komen.
 */
export function vervalVerlopenOffertes(handle: DatabaseHandle, nu = new Date()): number {
  const resultaat = handle.raw
    .prepare(
      `UPDATE package_quotes
          SET status = 'vervallen', updated_at = datetime('now')
        WHERE status = 'verstuurd' AND decided_at IS NULL
          AND valid_until IS NOT NULL AND valid_until < ?`,
    )
    .run(toIsoDate(nu));

  return Number(resultaat.changes ?? 0);
}

/** Alle offerteregels van één offerte, met de gegevens die het scherm nodig heeft. */
export function laadRegels(handle: DatabaseHandle, quoteId: number): Rij[] {
  return handle.raw
    .prepare(
      `SELECT r.*, p.sku, c.name AS categorie
         FROM package_quote_lines r
    LEFT JOIN products p ON p.id = r.product_id
    LEFT JOIN product_categories c ON c.id = p.category_id
        WHERE r.quote_id = ?
        ORDER BY r.sort_order, r.id`,
    )
    .all(quoteId) as Rij[];
}
