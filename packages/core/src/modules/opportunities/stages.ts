/**
 * Fasewisselingen, veroudering, winnen en verliezen (hoofdstuk 6.2).
 *
 * De fase van een kans is niet zomaar een kolom: elke wissel wordt vastgelegd
 * met hoe lang de kans in de vorige fase stond. Dat is wat later het rapport
 * "doorlooptijd per fase" mogelijk maakt — die informatie is niet achteraf te
 * reconstrueren, dus hij moet op het moment zelf worden bewaard.
 */
import type { DatabaseHandle } from '../../db/client.ts';
import { herberekenKans } from './recalculate.ts';

type Rij = Record<string, unknown>;

export class KansFout extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'KansFout';
    this.code = code;
  }
}

export type Fase = {
  id: number;
  name: string;
  sortOrder: number;
  defaultProbabilityBp: number;
  isWon: boolean;
  isLost: boolean;
  rottingDays: number | null;
  color: string | null;
};

export function laadFasen(handle: DatabaseHandle, pipelineId?: number): Fase[] {
  const rijen = handle.raw
    .prepare(
      `SELECT * FROM pipeline_stages
        WHERE archived_at IS NULL ${pipelineId ? 'AND pipeline_id = ?' : ''}
        ORDER BY sort_order, id`,
    )
    .all(...((pipelineId ? [pipelineId] : []) as never[])) as Rij[];

  return rijen.map((rij) => ({
    id: Number(rij.id),
    name: String(rij.name),
    sortOrder: Number(rij.sort_order),
    defaultProbabilityBp: Number(rij.default_probability_bp),
    isWon: Number(rij.is_won) === 1,
    isLost: Number(rij.is_lost) === 1,
    rottingDays: rij.rotting_days === null ? null : Number(rij.rotting_days),
    color: (rij.color as string | null) ?? null,
  }));
}

/** Hele dagen tussen twee tijdstempels; nooit negatief. */
export function dagenTussen(van: string | null, tot: Date): number | null {
  if (!van) return null;
  const start = new Date(van.includes('T') ? van : `${van.replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.round((tot.getTime() - start) / 86_400_000));
}

export type FaseWisselResultaat = {
  opportunityId: number;
  vanFase: number | null;
  naarFase: number;
  dagenInVorigeFase: number | null;
  status: 'open' | 'won' | 'lost';
};

/**
 * Verplaatst een kans naar een andere fase.
 *
 * De kans-in-procenten volgt de fase, tenzij iemand op de kans zelf een
 * afwijkende kans heeft gezet: een handmatige inschatting is meer waard dan
 * een default.
 */
export function wisselFase(
  handle: DatabaseHandle,
  opportunityId: number,
  naarFaseId: number,
  gebruikerId: number,
  nu = new Date(),
): FaseWisselResultaat {
  const kans = handle.raw
    .prepare('SELECT * FROM opportunities WHERE id = ? AND archived_at IS NULL')
    .get(opportunityId) as Rij | undefined;
  if (!kans) throw new KansFout('niet_gevonden', 'Deze kans bestaat niet.');

  const doel = handle.raw
    .prepare('SELECT * FROM pipeline_stages WHERE id = ? AND archived_at IS NULL')
    .get(naarFaseId) as Rij | undefined;
  if (!doel) throw new KansFout('onbekende_fase', 'Deze fase bestaat niet.');

  const vanFase = kans.stage_id === null ? null : Number(kans.stage_id);
  if (vanFase === naarFaseId) {
    return {
      opportunityId,
      vanFase,
      naarFase: naarFaseId,
      dagenInVorigeFase: null,
      status: String(kans.status) as 'open',
    };
  }

  const isWon = Number(doel.is_won) === 1;
  const isLost = Number(doel.is_lost) === 1;
  const status = isWon ? 'won' : isLost ? 'lost' : 'open';

  // Een verloren kans hoort een reden te hebben; die zet de aanroeper apart.
  const dagen = dagenTussen(
    (kans.stage_changed_at as string | null) ?? (kans.created_at as string | null),
    nu,
  );

  handle.raw.exec('BEGIN');
  try {
    handle.raw
      .prepare(
        `UPDATE opportunities
            SET stage_id = ?, status = ?, stage_changed_at = ?,
                probability_bp = COALESCE(probability_bp, ?),
                actual_close_date = CASE WHEN ? = 'open' THEN actual_close_date ELSE date('now') END,
                updated_at = datetime('now'), updated_by = ?
          WHERE id = ?`,
      )
      .run(
        naarFaseId,
        status,
        nu.toISOString(),
        Number(doel.default_probability_bp),
        status,
        gebruikerId,
        opportunityId,
      );

    handle.raw
      .prepare(
        `INSERT INTO opportunity_stage_history
           (opportunity_id, from_stage_id, to_stage_id, at, user_id, days_in_stage)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(opportunityId, vanFase, naarFaseId, nu.toISOString(), gebruikerId, dagen);

    handle.raw.exec('COMMIT');
  } catch (error) {
    handle.raw.exec('ROLLBACK');
    throw error;
  }

  herberekenKans(handle, opportunityId);
  return { opportunityId, vanFase, naarFase: naarFaseId, dagenInVorigeFase: dagen, status };
}

export type WinRegel = { lineId: number; wonAmountCents: number };

export type WinResultaat = {
  opportunityId: number;
  wonAmountCents: number;
  regels: number;
  projectId: number | null;
};

/**
 * Wint een kans, met per regel het bedrag dat daadwerkelijk is gescoord.
 *
 * Regels die niet in de lijst staan, worden als verloren gemarkeerd: bij een
 * gewonnen kans hoort een expliciete uitspraak per discipline, anders klopt de
 * omzet per discipline later niet.
 */
export function winKans(
  handle: DatabaseHandle,
  opportunityId: number,
  regels: readonly WinRegel[],
  gebruikerId: number,
  opties: { maakProject?: boolean } = {},
): WinResultaat {
  const kans = handle.raw
    .prepare('SELECT * FROM opportunities WHERE id = ? AND archived_at IS NULL')
    .get(opportunityId) as Rij | undefined;
  if (!kans) throw new KansFout('niet_gevonden', 'Deze kans bestaat niet.');

  const bestaande = handle.raw
    .prepare('SELECT id FROM opportunity_lines WHERE opportunity_id = ? AND archived_at IS NULL')
    .all(opportunityId) as Array<{ id: number }>;
  const geldigeIds = new Set(bestaande.map((rij) => Number(rij.id)));

  for (const regel of regels) {
    if (!geldigeIds.has(regel.lineId)) {
      throw new KansFout('onbekende_regel', `Regel ${regel.lineId} hoort niet bij deze kans.`);
    }
    if (!Number.isFinite(regel.wonAmountCents) || regel.wonAmountCents < 0) {
      throw new KansFout('ongeldig_bedrag', 'Een gescoord bedrag kan niet negatief zijn.');
    }
  }

  const winFase = handle.raw
    .prepare('SELECT id FROM pipeline_stages WHERE is_won = 1 AND archived_at IS NULL ORDER BY sort_order LIMIT 1')
    .get() as { id: number } | undefined;

  handle.raw.exec('BEGIN');
  try {
    const gewonnen = new Map(regels.map((regel) => [regel.lineId, regel.wonAmountCents]));

    for (const id of geldigeIds) {
      if (gewonnen.has(id)) {
        handle.raw
          .prepare("UPDATE opportunity_lines SET status = 'won', won_amount_cents = ? WHERE id = ?")
          .run(gewonnen.get(id)!, id);
      } else {
        handle.raw
          .prepare("UPDATE opportunity_lines SET status = 'lost', won_amount_cents = 0 WHERE id = ?")
          .run(id);
      }
    }

    handle.raw
      .prepare(
        `UPDATE opportunities
            SET status = 'won', actual_close_date = date('now'), probability_bp = 10000,
                stage_id = COALESCE(?, stage_id), stage_changed_at = datetime('now'),
                updated_at = datetime('now'), updated_by = ?
          WHERE id = ?`,
      )
      .run(winFase?.id ?? null, gebruikerId, opportunityId);

    if (winFase) {
      handle.raw
        .prepare(
          `INSERT INTO opportunity_stage_history
             (opportunity_id, from_stage_id, to_stage_id, user_id, days_in_stage)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          opportunityId,
          typeof kans.stage_id === 'number' ? kans.stage_id : null,
          winFase.id,
          gebruikerId,
          dagenTussen((kans.stage_changed_at as string | null) ?? null, new Date()),
        );
    }

    handle.raw.exec('COMMIT');
  } catch (error) {
    handle.raw.exec('ROLLBACK');
    throw error;
  }

  const herberekend = herberekenKans(handle, opportunityId);

  let projectId: number | null = null;
  if (opties.maakProject) projectId = maakProjectVanKans(handle, opportunityId, gebruikerId);

  return {
    opportunityId,
    wonAmountCents: herberekend?.wonAmountCents ?? 0,
    regels: regels.length,
    projectId,
  };
}

/**
 * Maakt een showroomproject aan uit een gewonnen kans en vult de fasen voor
 * uit de verwachte showroomperiode.
 *
 * Bewust geen "slim" raden: staat er geen verwachte periode op de kans, dan
 * komt er wel een project maar geen fase. Een verkeerd geraden fase belandt
 * ongemerkt in de capaciteitsberekening.
 */
export function maakProjectVanKans(
  handle: DatabaseHandle,
  opportunityId: number,
  gebruikerId: number,
): number {
  const kans = handle.raw.prepare('SELECT * FROM opportunities WHERE id = ?').get(opportunityId) as
    | Rij
    | undefined;
  if (!kans) throw new KansFout('niet_gevonden', 'Deze kans bestaat niet.');

  const bestaand = handle.raw
    .prepare('SELECT id FROM projects WHERE opportunity_id = ? AND archived_at IS NULL')
    .get(opportunityId) as { id: number } | undefined;
  if (bestaand) {
    throw new KansFout(
      'project_bestaat',
      'Er hangt al een project aan deze kans. Open dat project in plaats van een tweede aan te maken.',
    );
  }

  handle.raw.exec('BEGIN');
  try {
    const resultaat = handle.raw
      .prepare(
        `INSERT INTO projects
           (name, organization_id, opportunity_id, unit_count, contract_value_cents,
            counts_as_showroom, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        String(kans.name),
        typeof kans.organization_id === 'number' ? kans.organization_id : null,
        opportunityId,
        Number(kans.expected_units ?? 0),
        Number(kans.won_amount_cents ?? 0),
        gebruikerId,
        gebruikerId,
      );

    const projectId = Number(resultaat.lastInsertRowid);

    const start = kans.expected_showroom_start as string | null;
    const eind = kans.expected_showroom_end as string | null;
    if (start && eind) {
      const showroomFase = handle.raw
        .prepare(
          `SELECT i.id FROM picklist_items i
             JOIN picklists p ON p.id = i.picklist_id
            WHERE p.key = 'projectfase' AND i.value = 'showroom'`,
        )
        .get() as { id: number } | undefined;

      if (showroomFase) {
        handle.raw
          .prepare(
            `INSERT INTO project_phases (project_id, phase_type_id, start_date, end_date, is_capacity_load)
             VALUES (?, ?, ?, ?, 1)`,
          )
          .run(projectId, showroomFase.id, start, eind);
      }
    }

    handle.raw
      .prepare('UPDATE opportunities SET project_id = ? WHERE id = ?')
      .run(projectId, opportunityId);

    handle.raw.exec('COMMIT');
    return projectId;
  } catch (error) {
    handle.raw.exec('ROLLBACK');
    throw error;
  }
}

export type VerliesResultaat = { opportunityId: number; reden: number | null };

/** Verliest een kans. Een reden is verplicht (hoofdstuk 6.2). */
export function verliesKans(
  handle: DatabaseHandle,
  opportunityId: number,
  redenId: number | null,
  notitie: string | null,
  gebruikerId: number,
): VerliesResultaat {
  const kans = handle.raw
    .prepare('SELECT * FROM opportunities WHERE id = ? AND archived_at IS NULL')
    .get(opportunityId) as Rij | undefined;
  if (!kans) throw new KansFout('niet_gevonden', 'Deze kans bestaat niet.');

  // Zonder reden is het verliesrapport later waardeloos, dus hier afdwingen.
  if (redenId === null && (notitie === null || notitie.trim() === '')) {
    throw new KansFout(
      'reden_verplicht',
      'Kies een verliesreden of licht in het kort toe waarom deze kans niet doorgaat.',
    );
  }

  const verliesFase = handle.raw
    .prepare('SELECT id FROM pipeline_stages WHERE is_lost = 1 AND archived_at IS NULL ORDER BY sort_order LIMIT 1')
    .get() as { id: number } | undefined;

  handle.raw.exec('BEGIN');
  try {
    handle.raw
      .prepare(
        `UPDATE opportunities
            SET status = 'lost', loss_reason_id = ?, loss_note = ?,
                actual_close_date = date('now'), probability_bp = 0,
                stage_id = COALESCE(?, stage_id), stage_changed_at = datetime('now'),
                updated_at = datetime('now'), updated_by = ?
          WHERE id = ?`,
      )
      .run(redenId, notitie, verliesFase?.id ?? null, gebruikerId, opportunityId);

    handle.raw
      .prepare("UPDATE opportunity_lines SET status = 'lost', won_amount_cents = 0 WHERE opportunity_id = ?")
      .run(opportunityId);

    if (verliesFase) {
      handle.raw
        .prepare(
          `INSERT INTO opportunity_stage_history
             (opportunity_id, from_stage_id, to_stage_id, user_id, days_in_stage)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          opportunityId,
          typeof kans.stage_id === 'number' ? kans.stage_id : null,
          verliesFase.id,
          gebruikerId,
          dagenTussen((kans.stage_changed_at as string | null) ?? null, new Date()),
        );
    }

    handle.raw.exec('COMMIT');
  } catch (error) {
    handle.raw.exec('ROLLBACK');
    throw error;
  }

  herberekenKans(handle, opportunityId);
  return { opportunityId, reden: redenId };
}

export type VerouderdeKans = {
  id: number;
  name: string;
  stage: string;
  dagenStil: number;
  rottingDays: number;
  amountCents: number;
  eigenaar: string | null;
};

/**
 * Kansen die te lang stilstaan, op basis van `rotting_days` van hun fase.
 *
 * "Stil" is de laatste van: de laatste activiteit, de laatste fasewissel of
 * het aanmaken. Alleen naar de fasewissel kijken zou een kans waar wél mee
 * gebeld is ten onrechte als verouderd aanmerken.
 */
export function verouderdeKansen(handle: DatabaseHandle, nu = new Date()): VerouderdeKans[] {
  const rijen = handle.raw
    .prepare(
      `SELECT k.id, k.name, k.amount_cents, k.last_activity_at, k.stage_changed_at, k.created_at,
              s.name AS fase, s.rotting_days, u.name AS eigenaar
         FROM opportunities k
         JOIN pipeline_stages s ON s.id = k.stage_id
    LEFT JOIN users u ON u.id = k.owner_user_id
        WHERE k.archived_at IS NULL
          AND k.status = 'open'
          AND s.rotting_days IS NOT NULL`,
    )
    .all() as Rij[];

  const verouderd: VerouderdeKans[] = [];
  for (const rij of rijen) {
    const laatste =
      [rij.last_activity_at, rij.stage_changed_at, rij.created_at]
        .filter((waarde): waarde is string => typeof waarde === 'string')
        .sort()
        .pop() ?? null;

    const dagen = dagenTussen(laatste, nu);
    const grens = Number(rij.rotting_days);
    if (dagen === null || dagen < grens) continue;

    verouderd.push({
      id: Number(rij.id),
      name: String(rij.name),
      stage: String(rij.fase),
      dagenStil: dagen,
      rottingDays: grens,
      amountCents: Number(rij.amount_cents),
      eigenaar: (rij.eigenaar as string | null) ?? null,
    });
  }

  return verouderd.sort((a, b) => b.dagenStil - a.dagenStil);
}
