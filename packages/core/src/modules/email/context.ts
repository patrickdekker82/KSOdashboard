/**
 * De gegevens waar een e-mailsjabloon uit put (hoofdstuk 9).
 *
 * Welke groepen er beschikbaar zijn, hangt af van waar de mail over gaat: bij
 * een offerte hoort een klant en meestal een project, bij een losse
 * contactpersoon alleen die persoon. Wat er niet is, komt niet in de context —
 * en dan meldt de sjabloonmotor die plaatshouder als ontbrekend.
 */
import type { DatabaseHandle } from '../../db/client.ts';
import { bedrag, datum, zetGroep, type SjabloonContext } from './template.ts';

type Rij = Record<string, unknown>;

const tekst = (waarde: unknown): string | null =>
  waarde === null || waarde === undefined ? null : String(waarde);

/** De entiteiten waar een mail over kan gaan. */
export const ONDERWERPEN = new Set([
  'organizations',
  'contacts',
  'projects',
  'opportunities',
  'package-quotes',
]);

/**
 * Bouwt de context voor één record.
 *
 * Vult ook de gerelateerde onderwerpen: bij een offerte hoort de klant, het
 * project en de contactpersoon erbij, want een offertemail noemt die vrijwel
 * altijd.
 */
export function bouwContext(
  handle: DatabaseHandle,
  entiteit: string,
  recordId: number,
  gebruikerId: number,
): SjabloonContext {
  const context: SjabloonContext = new Map();

  zetGebruiker(handle, context, gebruikerId);
  zetBedrijf(handle, context);

  switch (entiteit) {
    case 'organizations':
      zetOrganisatie(handle, context, recordId);
      // De mail gaat naar de primaire contactpersoon, dus het sjabloon moet
      // hem kunnen noemen. Zonder dit wordt het "Beste ,".
      zetPrimairContact(handle, context, recordId);
      break;
    case 'contacts': {
      const contact = zetContact(handle, context, recordId);
      if (typeof contact?.organization_id === 'number') {
        zetOrganisatie(handle, context, contact.organization_id);
      }
      break;
    }
    case 'projects': {
      const project = zetProject(handle, context, recordId);
      if (typeof project?.organization_id === 'number') {
        zetOrganisatie(handle, context, project.organization_id);
        zetPrimairContact(handle, context, project.organization_id);
      }
      break;
    }
    case 'opportunities': {
      const kans = zetKans(handle, context, recordId);
      if (typeof kans?.organization_id === 'number') {
        zetOrganisatie(handle, context, kans.organization_id);
      }
      if (typeof kans?.primary_contact_id === 'number') {
        zetContact(handle, context, kans.primary_contact_id);
      } else if (typeof kans?.organization_id === 'number') {
        zetPrimairContact(handle, context, kans.organization_id);
      }
      break;
    }
    case 'package-quotes': {
      const offerte = zetOfferte(handle, context, recordId);
      if (typeof offerte?.organization_id === 'number') {
        zetOrganisatie(handle, context, offerte.organization_id);
      }
      // Staat er geen contactpersoon op de offerte, dan gaat de mail naar de
      // primaire contactpersoon van de klant — en dan moet het sjabloon die
      // ook kunnen noemen.
      if (typeof offerte?.contact_id === 'number') {
        zetContact(handle, context, offerte.contact_id);
      } else if (typeof offerte?.organization_id === 'number') {
        zetPrimairContact(handle, context, offerte.organization_id);
      }
      if (typeof offerte?.project_id === 'number') {
        zetProject(handle, context, offerte.project_id);
      }
      break;
    }
    default:
      break;
  }

  return context;
}

function zetGebruiker(handle: DatabaseHandle, context: SjabloonContext, id: number): void {
  const rij = handle.raw
    .prepare('SELECT name, initials, email FROM users WHERE id = ?')
    .get(id) as Rij | undefined;
  if (!rij) return;

  zetGroep(context, 'gebruiker', {
    naam: tekst(rij.name),
    initialen: tekst(rij.initials),
    email: tekst(rij.email),
  });
}

/** De bedrijfsgegevens uit de instellingen, voor de ondertekening. */
function zetBedrijf(handle: DatabaseHandle, context: SjabloonContext): void {
  const rij = handle.raw.prepare("SELECT value FROM settings WHERE key = 'bedrijf'").get() as
    | { value: string }
    | undefined;
  if (!rij) return;

  try {
    const waarden = JSON.parse(rij.value) as Record<string, unknown>;
    zetGroep(context, 'bedrijf', {
      naam: tekst(waarden.naam),
      adres: tekst(waarden.adres),
      plaats: tekst(waarden.plaats),
      telefoon: tekst(waarden.telefoon),
      email: tekst(waarden.email),
      website: tekst(waarden.website),
    });
  } catch {
    // Onleesbare instelling: dan blijven de bedrijfsplaatshouders leeg en
    // meldt de sjabloonmotor ze als ontbrekend.
  }
}

function zetOrganisatie(handle: DatabaseHandle, context: SjabloonContext, id: number): Rij | null {
  const rij = handle.raw.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as
    | Rij
    | undefined;
  if (!rij) return null;

  zetGroep(context, 'organisatie', {
    naam: tekst(rij.name),
    plaats: tekst(rij.city),
    adres: [tekst(rij.address_street), tekst(rij.address_number)].filter(Boolean).join(' ') || null,
    postcode: tekst(rij.postcode),
    telefoon: tekst(rij.phone),
    email: tekst(rij.email),
    website: tekst(rij.website),
  });
  return rij;
}

/** De contactpersoon waar de mail bij zo'n record naartoe zou gaan. */
function zetPrimairContact(handle: DatabaseHandle, context: SjabloonContext, organisatieId: number): void {
  const rij = handle.raw
    .prepare(
      `SELECT id FROM contacts
        WHERE organization_id = ? AND archived_at IS NULL
        ORDER BY is_primary DESC, id
        LIMIT 1`,
    )
    .get(organisatieId) as { id: number } | undefined;
  if (rij) zetContact(handle, context, Number(rij.id));
}

function zetContact(handle: DatabaseHandle, context: SjabloonContext, id: number): Rij | null {
  const rij = handle.raw.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as Rij | undefined;
  if (!rij) return null;

  const voornaam = tekst(rij.first_name);
  const tussen = tekst(rij.infix);
  const achter = tekst(rij.last_name);

  zetGroep(context, 'contact', {
    voornaam,
    achternaam: [tussen, achter].filter(Boolean).join(' ') || achter,
    volledigenaam: [voornaam, tussen, achter].filter(Boolean).join(' '),
    email: tekst(rij.email),
    telefoon: tekst(rij.phone ?? rij.mobile),
    aanhef: tekst(rij.salutation),
    functie: tekst(rij.job_title),
  });
  return rij;
}

function zetProject(handle: DatabaseHandle, context: SjabloonContext, id: number): Rij | null {
  const rij = handle.raw.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Rij | undefined;
  if (!rij) return null;

  zetGroep(context, 'project', {
    naam: tekst(rij.name),
    nummer: tekst(rij.number),
    plaats: tekst(rij.city),
    plan: tekst(rij.plan_name),
    woningen: rij.unit_count === null ? null : Number(rij.unit_count),
  });
  return rij;
}

function zetKans(handle: DatabaseHandle, context: SjabloonContext, id: number): Rij | null {
  const rij = handle.raw.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as
    | Rij
    | undefined;
  if (!rij) return null;

  zetGroep(context, 'kans', {
    naam: tekst(rij.name),
    nummer: tekst(rij.number),
    bedrag: bedrag(rij.amount_cents),
    sluitdatum: datum(rij.expected_close_date),
    woningen: rij.expected_units === null ? null : Number(rij.expected_units),
  });
  return rij;
}

function zetOfferte(handle: DatabaseHandle, context: SjabloonContext, id: number): Rij | null {
  const rij = handle.raw.prepare('SELECT * FROM package_quotes WHERE id = ?').get(id) as
    | Rij
    | undefined;
  if (!rij) return null;

  zetGroep(context, 'offerte', {
    nummer: tekst(rij.number),
    totaal: bedrag(rij.total_cents),
    subtotaal: bedrag(rij.subtotal_cents),
    btw: bedrag(rij.vat_cents),
    geldigtot: datum(rij.valid_until),
    verstuurdop: datum(rij.sent_at),
  });
  return rij;
}
