/**
 * Tijdlijn van een record (hoofdstuk 6.1).
 *
 * Eén chronologische lijst uit vier bronnen: activiteiten, wijzigingen uit het
 * auditlog, verzonden e-mail en offertes. Ze staan in aparte tabellen omdat ze
 * verschillende dingen zijn, maar voor wie een dossier doorneemt is het één
 * verhaal.
 */
import type { DatabaseHandle } from '../../db/client.ts';

export type TijdlijnSoort = 'activiteit' | 'wijziging' | 'email' | 'offerte' | 'fase';

export type TijdlijnItem = {
  soort: TijdlijnSoort;
  id: number;
  op: string;
  titel: string;
  tekst: string | null;
  door: string | null;
  /** Waar dit item heen linkt, als daar een scherm voor is. */
  link?: { entiteit: string; id: number };
};

type Rij = Record<string, unknown>;

/** Velden waarvan een wijziging niets zegt en die de tijdlijn zouden vervuilen. */
const ONBELANGRIJK = new Set([
  'updated_at',
  'updated_by',
  'created_at',
  'created_by',
  'last_activity_at',
  'amount_cents',
  'weighted_amount_cents',
]);

/** Beschrijft in gewone taal wat er in een auditregel is veranderd. */
export function beschrijfWijziging(voor: unknown, na: unknown): string | null {
  if (typeof voor !== 'string' || typeof na !== 'string') return null;

  let oud: Rij;
  let nieuw: Rij;
  try {
    oud = JSON.parse(voor) as Rij;
    nieuw = JSON.parse(na) as Rij;
  } catch {
    return null;
  }

  const veranderd = Object.keys(nieuw)
    .filter((sleutel) => !ONBELANGRIJK.has(sleutel))
    .filter((sleutel) => JSON.stringify(oud[sleutel]) !== JSON.stringify(nieuw[sleutel]))
    .slice(0, 6);

  if (veranderd.length === 0) return null;

  return veranderd
    .map((sleutel) => {
      const van = oud[sleutel];
      const naar = nieuw[sleutel];
      const toon = (waarde: unknown): string =>
        waarde === null || waarde === undefined || waarde === '' ? 'leeg' : String(waarde);
      return `${sleutel}: ${toon(van)} → ${toon(naar)}`;
    })
    .join(', ');
}

export function tijdlijnVoor(
  handle: DatabaseHandle,
  entiteit: string,
  recordId: number,
  limiet = 100,
): TijdlijnItem[] {
  const items: TijdlijnItem[] = [];

  // --- activiteiten ---------------------------------------------------------
  const activiteiten = handle.raw
    .prepare(
      `SELECT a.id, a.type, a.subject, a.body, a.status, a.completed_at, a.due_at, a.created_at,
              u.name AS door
         FROM activities a
         JOIN activity_links l ON l.activity_id = a.id
    LEFT JOIN users u ON u.id = a.assigned_user_id
        WHERE l.entity_key = ? AND l.record_id = ? AND a.archived_at IS NULL
        ORDER BY COALESCE(a.completed_at, a.due_at, a.created_at) DESC
        LIMIT ?`,
    )
    .all(entiteit, recordId, limiet) as Rij[];

  for (const rij of activiteiten) {
    items.push({
      soort: 'activiteit',
      id: Number(rij.id),
      op: String(rij.completed_at ?? rij.due_at ?? rij.created_at),
      titel: `${String(rij.type)}: ${String(rij.subject)}`,
      tekst: (rij.body as string | null) ?? null,
      door: (rij.door as string | null) ?? null,
    });
  }

  // --- wijzigingen ----------------------------------------------------------
  const wijzigingen = handle.raw
    .prepare(
      `SELECT a.id, a.action, a.before, a.after, a.at, u.name AS door
         FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
        WHERE a.entity_key = ? AND a.record_id = ?
        ORDER BY a.at DESC
        LIMIT ?`,
    )
    .all(entiteit, recordId, limiet) as Rij[];

  for (const rij of wijzigingen) {
    const actie = String(rij.action);
    const beschrijving = actie === 'gewijzigd' ? beschrijfWijziging(rij.before, rij.after) : null;

    // Een wijziging waarbij alleen tijdstempels veranderden, zegt niets.
    if (actie === 'gewijzigd' && beschrijving === null) continue;

    items.push({
      soort: 'wijziging',
      id: Number(rij.id),
      op: String(rij.at),
      titel:
        actie === 'aangemaakt'
          ? 'Aangemaakt'
          : actie === 'gewijzigd'
            ? 'Gewijzigd'
            : actie === 'samengevoegd'
              ? 'Samengevoegd met een dubbel record'
              : actie,
      tekst: beschrijving,
      door: (rij.door as string | null) ?? null,
    });
  }

  // --- e-mail ---------------------------------------------------------------
  const mails = handle.raw
    .prepare(
      `SELECT m.id, m.subject, m.status, m.sent_at, m.queued_at, m.to_json, u.name AS door
         FROM email_messages m
         JOIN email_message_links l ON l.message_id = m.id
    LEFT JOIN users u ON u.id = m.created_by
        WHERE l.entity_key = ? AND l.record_id = ?
        ORDER BY COALESCE(m.sent_at, m.queued_at) DESC
        LIMIT ?`,
    )
    .all(entiteit, recordId, limiet) as Rij[];

  for (const rij of mails) {
    let ontvangers = '';
    try {
      ontvangers = (JSON.parse(String(rij.to_json ?? '[]')) as string[]).join(', ');
    } catch {
      ontvangers = '';
    }
    items.push({
      soort: 'email',
      id: Number(rij.id),
      op: String(rij.sent_at ?? rij.queued_at),
      titel: `E-mail: ${String(rij.subject)}`,
      tekst: ontvangers ? `Aan ${ontvangers}` : null,
      door: (rij.door as string | null) ?? null,
    });
  }

  // --- offertes -------------------------------------------------------------
  if (entiteit === 'organizations' || entiteit === 'contacts') {
    const kolom = entiteit === 'organizations' ? 'organization_id' : 'contact_id';
    const offertes = handle.raw
      .prepare(
        `SELECT q.id, q.number, q.status, q.total_cents, q.sent_at, q.created_at, u.name AS door
           FROM package_quotes q
      LEFT JOIN users u ON u.id = q.owner_user_id
          WHERE q.${kolom} = ? AND q.archived_at IS NULL
          ORDER BY COALESCE(q.sent_at, q.created_at) DESC
          LIMIT ?`,
      )
      .all(recordId, limiet) as Rij[];

    for (const rij of offertes) {
      items.push({
        soort: 'offerte',
        id: Number(rij.id),
        op: String(rij.sent_at ?? rij.created_at),
        titel: `Offerte ${String(rij.number ?? rij.id)} (${String(rij.status)})`,
        tekst: null,
        door: (rij.door as string | null) ?? null,
        link: { entiteit: 'package-quotes', id: Number(rij.id) },
      });
    }
  }

  // --- fasewisselingen ------------------------------------------------------
  if (entiteit === 'opportunities') {
    const fasen = handle.raw
      .prepare(
        `SELECT h.id, h.at, h.days_in_stage, van.name AS van_fase, naar.name AS naar_fase, u.name AS door
           FROM opportunity_stage_history h
      LEFT JOIN pipeline_stages van ON van.id = h.from_stage_id
      LEFT JOIN pipeline_stages naar ON naar.id = h.to_stage_id
      LEFT JOIN users u ON u.id = h.user_id
          WHERE h.opportunity_id = ?
          ORDER BY h.at DESC LIMIT ?`,
      )
      .all(recordId, limiet) as Rij[];

    for (const rij of fasen) {
      items.push({
        soort: 'fase',
        id: Number(rij.id),
        op: String(rij.at),
        titel: `Fase: ${String(rij.van_fase ?? 'nieuw')} → ${String(rij.naar_fase ?? '?')}`,
        tekst: rij.days_in_stage ? `${Number(rij.days_in_stage)} dagen in de vorige fase` : null,
        door: (rij.door as string | null) ?? null,
      });
    }
  }

  // Nieuwste bovenaan; bij gelijke tijd komt de activiteit voor de wijziging,
  // want die vertelt meer.
  const volgorde: Record<TijdlijnSoort, number> = {
    activiteit: 0,
    email: 1,
    offerte: 2,
    fase: 3,
    wijziging: 4,
  };

  return items
    .sort((a, b) => (a.op === b.op ? volgorde[a.soort] - volgorde[b.soort] : (a.op < b.op ? 1 : -1)))
    .slice(0, limiet);
}
