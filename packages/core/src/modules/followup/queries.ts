/**
 * Opvolging: wat er vandaag te doen is (hoofdstuk 9).
 *
 * Een verkoopsysteem valt of staat bij de vraag "wat moet ik nu doen". Deze
 * module beantwoordt die vraag met vier bakjes, en dat is met opzet weinig: een
 * scherm met tien secties is een scherm dat niemand afwerkt.
 */
import { toIsoDate } from '@showroom/shared';
import type { DatabaseHandle } from '../../db/client.ts';

type Rij = Record<string, unknown>;

export type Werklijst = {
  teLaat: Rij[];
  vandaag: Rij[];
  komend: Rij[];
  zonderDatum: Rij[];
};

/**
 * De open activiteiten van één gebruiker, in vier bakjes.
 *
 * "Zonder datum" staat er apart bij: dat zijn taken die iemand heeft aangemaakt
 * en nooit heeft ingepland. Zonder eigen bakje verdwijnen ze uit beeld, en dan
 * is de takenlijst een plek waar dingen heen gaan om te sterven.
 */
export function werklijst(
  handle: DatabaseHandle,
  gebruikerId: number,
  nu = new Date(),
  dagenVooruit = 14,
): Werklijst {
  const vandaag = toIsoDate(nu);
  const grens = toIsoDate(new Date(nu.getTime() + dagenVooruit * 86_400_000));

  const rijen = handle.raw
    .prepare(
      `SELECT a.*, u.name AS eigenaar,
              (SELECT l.entity_key FROM activity_links l WHERE l.activity_id = a.id LIMIT 1) AS entiteit,
              (SELECT l.record_id FROM activity_links l WHERE l.activity_id = a.id LIMIT 1) AS record_id
         FROM activities a
    LEFT JOIN users u ON u.id = a.assigned_user_id
        WHERE a.archived_at IS NULL
          AND a.status = 'open'
          AND a.completed_at IS NULL
          AND a.assigned_user_id = ?
        ORDER BY a.due_at IS NULL, a.due_at, a.priority = 'hoog' DESC, a.id`,
    )
    .all(gebruikerId) as Rij[];

  const datumVan = (rij: Rij): string | null =>
    rij.due_at === null || rij.due_at === undefined ? null : String(rij.due_at).slice(0, 10);

  return {
    teLaat: rijen.filter((rij) => {
      const datum = datumVan(rij);
      return datum !== null && datum < vandaag;
    }),
    vandaag: rijen.filter((rij) => datumVan(rij) === vandaag),
    komend: rijen.filter((rij) => {
      const datum = datumVan(rij);
      return datum !== null && datum > vandaag && datum <= grens;
    }),
    zonderDatum: rijen.filter((rij) => datumVan(rij) === null),
  };
}

export class OpvolgFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OpvolgFout';
    this.code = code;
  }
}

export type AfrondInvoer = {
  /** Wat er uit het gesprek kwam; komt in de tijdlijn. */
  uitkomst?: string | null;
  outcomeId?: number | null;
  /** Meteen een vervolgactie inplannen. */
  vervolg?: {
    type: string;
    subject: string;
    dueAt: string;
    assignedUserId?: number | null;
  } | null;
};

/**
 * Rondt een activiteit af en plant desgewenst meteen de volgende.
 *
 * Dat laatste in dezelfde handeling is het hele punt: een gesprek dat eindigt
 * met "ik bel over twee weken terug" en waar niemand iets voor inplant, is een
 * gesprek dat geen vervolg krijgt.
 */
export function rondAf(
  handle: DatabaseHandle,
  activiteitId: number,
  invoer: AfrondInvoer,
  gebruikerId: number,
  nu = new Date(),
): { activiteitId: number; vervolgId: number | null } {
  const activiteit = handle.raw
    .prepare('SELECT * FROM activities WHERE id = ? AND archived_at IS NULL')
    .get(activiteitId) as Rij | undefined;
  if (!activiteit) throw new OpvolgFout('niet_gevonden', 'Deze activiteit bestaat niet.');
  if (activiteit.completed_at !== null) {
    throw new OpvolgFout('al_afgerond', 'Deze activiteit is al afgerond.');
  }
  if (invoer.vervolg && invoer.vervolg.subject.trim() === '') {
    throw new OpvolgFout('geen_onderwerp', 'Geef aan waar de vervolgactie over gaat.');
  }

  const tijdstempel = nu.toISOString().slice(0, 19).replace('T', ' ');

  handle.raw.exec('BEGIN');
  try {
    handle.raw
      .prepare(
        `UPDATE activities
            SET status = 'afgerond', completed_at = ?, outcome_id = COALESCE(?, outcome_id),
                body = COALESCE(?, body), updated_at = datetime('now'), updated_by = ?
          WHERE id = ?`,
      )
      .run(
        tijdstempel,
        invoer.outcomeId ?? null,
        invoer.uitkomst ?? null,
        gebruikerId,
        activiteitId,
      );

    let vervolgId: number | null = null;

    if (invoer.vervolg) {
      const vervolg = handle.raw
        .prepare(
          `INSERT INTO activities
             (type, subject, status, due_at, assigned_user_id, created_by, updated_by)
           VALUES (?, ?, 'open', ?, ?, ?, ?)`,
        )
        .run(
          invoer.vervolg.type,
          invoer.vervolg.subject.trim(),
          invoer.vervolg.dueAt,
          invoer.vervolg.assignedUserId ??
            (typeof activiteit.assigned_user_id === 'number'
              ? activiteit.assigned_user_id
              : gebruikerId),
          gebruikerId,
          gebruikerId,
        );

      vervolgId = Number(vervolg.lastInsertRowid);

      // De vervolgactie hangt aan dezelfde records als de activiteit die hem
      // opriep; anders staat hij nergens in een tijdlijn.
      const koppelingen = handle.raw
        .prepare('SELECT entity_key, record_id FROM activity_links WHERE activity_id = ?')
        .all(activiteitId) as Rij[];

      const koppel = handle.raw.prepare(
        'INSERT INTO activity_links (activity_id, entity_key, record_id) VALUES (?, ?, ?)',
      );
      for (const koppeling of koppelingen) {
        koppel.run(vervolgId, String(koppeling.entity_key), Number(koppeling.record_id));
      }

      handle.raw
        .prepare('UPDATE activities SET next_activity_id = ? WHERE id = ?')
        .run(vervolgId, activiteitId);
    }

    handle.raw.exec('COMMIT');
    return { activiteitId, vervolgId };
  } catch (error) {
    handle.raw.exec('ROLLBACK');
    throw error;
  }
}

// --- bellijsten ------------------------------------------------------------

export type BellijstRegel = Rij & { titel: string; afgehandeld: boolean };

/** Welke tabel en kolom de naam van een record levert, per soort. */
const TITELBRON: Record<string, { tabel: string; kolom: string }> = {
  organizations: { tabel: 'organizations', kolom: 'name' },
  contacts: { tabel: 'contacts', kolom: "COALESCE(first_name || ' ', '') || last_name" },
  projects: { tabel: 'projects', kolom: 'name' },
  opportunities: { tabel: 'opportunities', kolom: 'name' },
};

/**
 * De leden van een bellijst, met de naam van het record erbij.
 *
 * Afgehandelde regels zakken naar beneden in plaats van te verdwijnen: zo is te
 * zien hoever de lijst is, en kan iemand een vinkje terugdraaien.
 */
export function bellijst(handle: DatabaseHandle, lijstId: number): BellijstRegel[] {
  const leden = handle.raw
    .prepare(
      `SELECT * FROM call_list_members
        WHERE call_list_id = ?
        ORDER BY done_at IS NOT NULL, sort_order, record_id`,
    )
    .all(lijstId) as Rij[];

  const titels = new Map<string, Map<number, string>>();

  for (const soort of new Set(leden.map((lid) => String(lid.entity_key)))) {
    const bron = TITELBRON[soort];
    if (!bron) continue;

    const kaart = new Map<number, string>();
    for (const rij of handle.raw
      .prepare(`SELECT id, ${bron.kolom} AS titel FROM ${bron.tabel}`)
      .all() as Rij[]) {
      kaart.set(Number(rij.id), String(rij.titel ?? ''));
    }
    titels.set(soort, kaart);
  }

  return leden.map((lid) => ({
    ...lid,
    titel:
      titels.get(String(lid.entity_key))?.get(Number(lid.record_id)) ??
      `${String(lid.entity_key)} #${String(lid.record_id)}`,
    afgehandeld: lid.done_at !== null,
  }));
}

/** Zet een regel van een bellijst op afgehandeld, of juist terug. */
export function markeerBelregel(
  handle: DatabaseHandle,
  lijstId: number,
  entiteit: string,
  recordId: number,
  gedaan: boolean,
  notitie: string | null,
  nu = new Date(),
): void {
  const resultaat = handle.raw
    .prepare(
      `UPDATE call_list_members
          SET done_at = ?, note = COALESCE(?, note)
        WHERE call_list_id = ? AND entity_key = ? AND record_id = ?`,
    )
    .run(
      gedaan ? nu.toISOString().slice(0, 19).replace('T', ' ') : null,
      notitie,
      lijstId,
      entiteit,
      recordId,
    );

  if (Number(resultaat.changes ?? 0) === 0) {
    throw new OpvolgFout('niet_gevonden', 'Deze regel staat niet op de bellijst.');
  }
}
