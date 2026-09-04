/**
 * AVG-functies voor contactpersonen (hoofdstuk 6.1 en 10).
 *
 * Twee rechten van betrokkenen die het systeem zelf moet kunnen bedienen:
 *
 *   inzage      — alles wat er over iemand is vastgelegd, in één bestand
 *   vergetelheid — persoonsgegevens overschrijven, maar de zakelijke
 *                  transacties bewaren
 *
 * Dat tweede is de kern van deze module. Een offerte van € 12.000 mag niet
 * verdwijnen omdat de contactpersoon vergeten wil worden: het bedrag is
 * bedrijfsadministratie, de naam en het e-mailadres zijn persoonsgegevens.
 * Anonimiseren verwijdert dus niet de rij, maar maakt hem onherleidbaar.
 */
import type { DatabaseHandle } from '../../db/client.ts';

type Rij = Record<string, unknown>;

/** Kolommen op `contacts` die een persoon identificeren. */
export const PERSOONSGEGEVENS = [
  'salutation',
  'first_name',
  'infix',
  'email',
  'phone',
  'mobile',
  'linkedin',
  'birthday',
  'notes',
  'initials',
] as const;

export type Inzagedossier = {
  contact: Rij;
  organisatie: Rij | null;
  activiteiten: Rij[];
  emails: Rij[];
  offertes: Rij[];
  kansen: Rij[];
  bijlagen: Rij[];
  wijzigingen: Rij[];
  opgesteldOp: string;
};

/**
 * Alles wat er over één contactpersoon is vastgelegd.
 *
 * Bewust breed: bij een inzageverzoek is een te smal antwoord het probleem,
 * niet een te breed.
 */
export function inzagedossier(handle: DatabaseHandle, contactId: number): Inzagedossier | null {
  const contact = handle.raw.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId) as
    | Rij
    | undefined;
  if (!contact) return null;

  const organisatieId = contact.organization_id;
  const organisatie =
    typeof organisatieId === 'number'
      ? ((handle.raw.prepare('SELECT * FROM organizations WHERE id = ?').get(organisatieId) as
          | Rij
          | undefined) ?? null)
      : null;

  return {
    contact,
    organisatie,
    activiteiten: handle.raw
      .prepare(
        `SELECT a.* FROM activities a
           JOIN activity_links l ON l.activity_id = a.id
          WHERE l.entity_key = 'contacts' AND l.record_id = ?
          ORDER BY a.created_at`,
      )
      .all(contactId) as Rij[],
    emails: handle.raw
      .prepare(
        `SELECT m.id, m.subject, m.to_json, m.status, m.sent_at, m.body_text
           FROM email_messages m
           JOIN email_message_links l ON l.message_id = m.id
          WHERE l.entity_key = 'contacts' AND l.record_id = ?
          ORDER BY m.queued_at`,
      )
      .all(contactId) as Rij[],
    offertes: handle.raw
      .prepare('SELECT * FROM package_quotes WHERE contact_id = ? ORDER BY created_at')
      .all(contactId) as Rij[],
    kansen: handle.raw
      .prepare('SELECT * FROM opportunities WHERE primary_contact_id = ? ORDER BY created_at')
      .all(contactId) as Rij[],
    bijlagen: handle.raw
      .prepare("SELECT * FROM attachments WHERE entity_key = 'contacts' AND record_id = ?")
      .all(contactId) as Rij[],
    wijzigingen: handle.raw
      .prepare(
        "SELECT id, action, at, user_id FROM audit_log WHERE entity_key = 'contacts' AND record_id = ? ORDER BY at",
      )
      .all(contactId) as Rij[],
    opgesteldOp: new Date().toISOString(),
  };
}

export type AnonimiseerResultaat = {
  contactId: number;
  /** Welke kolommen zijn overschreven. */
  overschreven: string[];
  /** Wat er is blijven staan, met hoeveel. */
  behouden: Array<{ wat: string; aantal: number }>;
};

/**
 * Maakt een contactpersoon onherleidbaar.
 *
 * De rij blijft bestaan, zodat offertes en kansen hun koppeling houden en de
 * omzetcijfers blijven kloppen. Alleen de identificerende velden gaan eruit.
 */
export function anonimiseer(
  handle: DatabaseHandle,
  contactId: number,
  gebruikerId: number,
): AnonimiseerResultaat | null {
  const contact = handle.raw.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId) as
    | Rij
    | undefined;
  if (!contact) return null;

  const tel = (sql: string): number =>
    Number((handle.raw.prepare(sql).get(contactId) as { n: number }).n);

  const behouden = [
    { wat: 'offertes', aantal: tel('SELECT COUNT(*) AS n FROM package_quotes WHERE contact_id = ?') },
    { wat: 'kansen', aantal: tel('SELECT COUNT(*) AS n FROM opportunities WHERE primary_contact_id = ?') },
    {
      wat: 'activiteiten',
      aantal: tel(
        "SELECT COUNT(*) AS n FROM activity_links WHERE entity_key = 'contacts' AND record_id = ?",
      ),
    },
  ];

  handle.raw.exec('BEGIN');
  try {
    handle.raw
      .prepare(
        `UPDATE contacts
            SET last_name = ?,
                salutation = NULL, first_name = NULL, infix = NULL, initials = NULL,
                email = NULL, phone = NULL, mobile = NULL, linkedin = NULL,
                birthday = NULL, notes = NULL,
                do_not_email = 1, do_not_call = 1,
                marketing_consent = 0, consent_at = NULL, consent_source = NULL,
                anonymised_at = datetime('now'),
                updated_at = datetime('now'), updated_by = ?
          WHERE id = ?`,
      )
      .run(`Geanonimiseerd #${contactId}`, gebruikerId, contactId);

    // De zoekindex meeschrijven gebeurt via de trigger op contacts.

    // Het auditlog bevat de oude waarden in `before`/`after`; die moeten mee.
    // Anders staat de naam die net gewist is nog gewoon in de geschiedenis.
    handle.raw
      .prepare(
        `UPDATE audit_log
            SET before = NULL, after = NULL
          WHERE entity_key = 'contacts' AND record_id = ?`,
      )
      .run(contactId);

    handle.raw
      .prepare(
        `INSERT INTO audit_log (user_id, entity_key, record_id, action, before, after)
         VALUES (?, 'contacts', ?, 'geanonimiseerd', NULL, ?)`,
      )
      .run(gebruikerId, contactId, JSON.stringify({ behouden }));

    handle.raw.exec('COMMIT');
  } catch (error) {
    handle.raw.exec('ROLLBACK');
    throw error;
  }

  return { contactId, overschreven: [...PERSOONSGEGEVENS, 'last_name'], behouden };
}

/**
 * Contactpersonen waar al lang niets mee gebeurd is.
 *
 * De AVG vraagt niet om een vaste termijn maar om een bewuste keuze; deze
 * lijst is het hulpmiddel om die keuze te kunnen maken.
 */
export function verlopenBewaartermijn(handle: DatabaseHandle, dagen: number): Rij[] {
  return handle.raw
    .prepare(
      `SELECT c.id, c.first_name, c.infix, c.last_name, c.email, c.created_at,
              MAX(COALESCE(a.completed_at, a.due_at, a.created_at)) AS laatste_activiteit
         FROM contacts c
    LEFT JOIN activity_links l ON l.entity_key = 'contacts' AND l.record_id = c.id
    LEFT JOIN activities a ON a.id = l.activity_id
        WHERE c.archived_at IS NULL
          AND c.anonymised_at IS NULL
        GROUP BY c.id
       HAVING COALESCE(laatste_activiteit, c.created_at) < date('now', ?)
        ORDER BY COALESCE(laatste_activiteit, c.created_at)`,
    )
    .all(`-${Math.max(1, Math.round(dagen))} days`) as Rij[];
}
