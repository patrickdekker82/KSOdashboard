/**
 * Rapportage over kansen (hoofdstuk 6.2).
 *
 * Vijf vragen die het verkoopoverleg stelt:
 *   - hoe ziet de trechter eruit?
 *   - wat winnen we, en waarop?
 *   - hoe lang duurt elke fase?
 *   - wat levert elke discipline op?
 *   - waarom verliezen we?
 *
 * Alles rekent in centen; de omzetting naar euro's gebeurt pas in de UI.
 */
import type { DatabaseHandle } from '../../db/client.ts';

type Rij = Record<string, unknown>;

export type TrechterFase = {
  stageId: number;
  fase: string;
  volgorde: number;
  kleur: string | null;
  aantal: number;
  bedragCents: number;
  gewogenCents: number;
};

/** Open kansen per fase, met aantal en bedrag. */
export function trechter(handle: DatabaseHandle, pipelineId?: number): TrechterFase[] {
  const rijen = handle.raw
    .prepare(
      `SELECT s.id, s.name, s.sort_order, s.color,
              COUNT(k.id) AS aantal,
              COALESCE(SUM(k.amount_cents), 0) AS bedrag,
              COALESCE(SUM(k.weighted_amount_cents), 0) AS gewogen
         FROM pipeline_stages s
    LEFT JOIN opportunities k
           ON k.stage_id = s.id AND k.status = 'open' AND k.archived_at IS NULL
        WHERE s.archived_at IS NULL AND s.is_won = 0 AND s.is_lost = 0
          ${pipelineId ? 'AND s.pipeline_id = ?' : ''}
        GROUP BY s.id
        ORDER BY s.sort_order`,
    )
    .all(...((pipelineId ? [pipelineId] : []) as never[])) as Rij[];

  return rijen.map((rij) => ({
    stageId: Number(rij.id),
    fase: String(rij.name),
    volgorde: Number(rij.sort_order),
    kleur: (rij.color as string | null) ?? null,
    aantal: Number(rij.aantal),
    bedragCents: Number(rij.bedrag),
    gewogenCents: Number(rij.gewogen),
  }));
}

export type WinRate = {
  sleutel: string;
  label: string;
  gewonnen: number;
  verloren: number;
  winRatePct: number;
  gescoordCents: number;
};

/**
 * Win-rate per discipline, eigenaar of bron.
 *
 * Bij discipline wordt op regelniveau geteld: een kans kan op tegelwerk
 * gewonnen worden en op keukens verloren, en dat is precies wat je wilt weten.
 */
export function winRate(
  handle: DatabaseHandle,
  per: 'discipline' | 'eigenaar' | 'bron',
  van?: string,
  tot?: string,
): WinRate[] {
  const periode = van && tot ? 'AND k.actual_close_date BETWEEN ? AND ?' : '';
  const parameters = van && tot ? [van, tot] : [];

  if (per === 'discipline') {
    const rijen = handle.raw
      .prepare(
        `SELECT d.id AS sleutel, d.name AS label,
                SUM(CASE WHEN r.status = 'won' THEN 1 ELSE 0 END) AS gewonnen,
                SUM(CASE WHEN r.status = 'lost' THEN 1 ELSE 0 END) AS verloren,
                COALESCE(SUM(CASE WHEN r.status = 'won'
                                  THEN COALESCE(r.won_amount_cents, r.amount_cents) ELSE 0 END), 0) AS gescoord
           FROM opportunity_lines r
           JOIN disciplines d ON d.id = r.discipline_id
           JOIN opportunities k ON k.id = r.opportunity_id
          WHERE r.archived_at IS NULL AND k.archived_at IS NULL
            AND r.status IN ('won', 'lost') ${periode}
          GROUP BY d.id
          ORDER BY gescoord DESC`,
      )
      .all(...(parameters as never[])) as Rij[];
    return rijen.map(naarWinRate);
  }

  const kolom = per === 'eigenaar' ? 'u.name' : 'i.label';
  const join =
    per === 'eigenaar'
      ? 'LEFT JOIN users u ON u.id = k.owner_user_id'
      : 'LEFT JOIN picklist_items i ON i.id = k.source_id';
  const sleutel = per === 'eigenaar' ? 'k.owner_user_id' : 'k.source_id';

  const rijen = handle.raw
    .prepare(
      `SELECT ${sleutel} AS sleutel, COALESCE(${kolom}, 'Onbekend') AS label,
              SUM(CASE WHEN k.status = 'won' THEN 1 ELSE 0 END) AS gewonnen,
              SUM(CASE WHEN k.status = 'lost' THEN 1 ELSE 0 END) AS verloren,
              COALESCE(SUM(CASE WHEN k.status = 'won' THEN k.won_amount_cents ELSE 0 END), 0) AS gescoord
         FROM opportunities k
         ${join}
        WHERE k.archived_at IS NULL AND k.status IN ('won', 'lost') ${periode}
        GROUP BY sleutel
        ORDER BY gescoord DESC`,
    )
    .all(...(parameters as never[])) as Rij[];

  return rijen.map(naarWinRate);
}

function naarWinRate(rij: Rij): WinRate {
  const gewonnen = Number(rij.gewonnen);
  const verloren = Number(rij.verloren);
  const totaal = gewonnen + verloren;
  return {
    sleutel: String(rij.sleutel ?? ''),
    label: String(rij.label),
    gewonnen,
    verloren,
    // Zonder afgesloten kansen is een win-rate betekenisloos, geen 0%.
    winRatePct: totaal === 0 ? 0 : Math.round((gewonnen / totaal) * 1000) / 10,
    gescoordCents: Number(rij.gescoord),
  };
}

export type DoorlooptijdFase = {
  stageId: number;
  fase: string;
  volgorde: number;
  gemiddeldeDagen: number;
  medianeDagen: number;
  metingen: number;
};

/**
 * Hoe lang kansen in elke fase blijven staan.
 *
 * Naast het gemiddelde ook de mediaan: één kans die twee jaar bleef liggen
 * trekt een gemiddelde volledig scheef, en dan lijkt een fase trager dan hij is.
 */
export function doorlooptijdPerFase(handle: DatabaseHandle): DoorlooptijdFase[] {
  const rijen = handle.raw
    .prepare(
      `SELECT h.from_stage_id AS stage_id, s.name, s.sort_order, h.days_in_stage
         FROM opportunity_stage_history h
         JOIN pipeline_stages s ON s.id = h.from_stage_id
        WHERE h.days_in_stage IS NOT NULL
        ORDER BY s.sort_order`,
    )
    .all() as Rij[];

  const perFase = new Map<number, { naam: string; volgorde: number; dagen: number[] }>();
  for (const rij of rijen) {
    const id = Number(rij.stage_id);
    const entry = perFase.get(id) ?? {
      naam: String(rij.name),
      volgorde: Number(rij.sort_order),
      dagen: [],
    };
    entry.dagen.push(Number(rij.days_in_stage));
    perFase.set(id, entry);
  }

  return [...perFase.entries()]
    .map(([stageId, entry]) => {
      const gesorteerd = [...entry.dagen].sort((a, b) => a - b);
      const midden = Math.floor(gesorteerd.length / 2);
      const mediaan =
        gesorteerd.length % 2 === 0
          ? ((gesorteerd[midden - 1] ?? 0) + (gesorteerd[midden] ?? 0)) / 2
          : (gesorteerd[midden] ?? 0);

      return {
        stageId,
        fase: entry.naam,
        volgorde: entry.volgorde,
        gemiddeldeDagen:
          Math.round((entry.dagen.reduce((som, dag) => som + dag, 0) / entry.dagen.length) * 10) / 10,
        medianeDagen: Math.round(mediaan * 10) / 10,
        metingen: entry.dagen.length,
      };
    })
    .sort((a, b) => a.volgorde - b.volgorde);
}

export type OmzetPerDiscipline = {
  discipline: string;
  maand: string;
  aantalRegels: number;
  gescoordCents: number;
};

/** Gescoorde omzet per discipline per maand. */
export function omzetPerDiscipline(
  handle: DatabaseHandle,
  van?: string,
  tot?: string,
): OmzetPerDiscipline[] {
  const periode = van && tot ? 'AND k.actual_close_date BETWEEN ? AND ?' : '';
  const parameters = van && tot ? [van, tot] : [];

  const rijen = handle.raw
    .prepare(
      `SELECT d.name AS discipline,
              SUBSTR(k.actual_close_date, 1, 7) AS maand,
              COUNT(*) AS aantal,
              COALESCE(SUM(COALESCE(r.won_amount_cents, r.amount_cents)), 0) AS gescoord
         FROM opportunity_lines r
         JOIN opportunities k ON k.id = r.opportunity_id
         JOIN disciplines d ON d.id = r.discipline_id
        WHERE r.status = 'won'
          AND k.actual_close_date IS NOT NULL
          AND r.archived_at IS NULL AND k.archived_at IS NULL ${periode}
        GROUP BY d.name, maand
        ORDER BY maand, gescoord DESC`,
    )
    .all(...(parameters as never[])) as Rij[];

  return rijen.map((rij) => ({
    discipline: String(rij.discipline),
    maand: String(rij.maand),
    aantalRegels: Number(rij.aantal),
    gescoordCents: Number(rij.gescoord),
  }));
}

export type Verliesreden = {
  reden: string;
  aantal: number;
  gemistCents: number;
};

/** De top tien verliesredenen, met wat er aan omzet mee wegviel. */
export function verliesredenen(handle: DatabaseHandle, limiet = 10): Verliesreden[] {
  const rijen = handle.raw
    .prepare(
      `SELECT COALESCE(i.label, 'Geen reden opgegeven') AS reden,
              COUNT(*) AS aantal,
              COALESCE(SUM(k.amount_cents), 0) AS gemist
         FROM opportunities k
    LEFT JOIN picklist_items i ON i.id = k.loss_reason_id
        WHERE k.status = 'lost' AND k.archived_at IS NULL
        GROUP BY k.loss_reason_id
        ORDER BY aantal DESC, gemist DESC
        LIMIT ?`,
    )
    .all(limiet) as Rij[];

  return rijen.map((rij) => ({
    reden: String(rij.reden),
    aantal: Number(rij.aantal),
    gemistCents: Number(rij.gemist),
  }));
}

export type PipelineSamenvatting = {
  openAantal: number;
  openCents: number;
  gewogenCents: number;
  gescoordDitJaarCents: number;
  winRatePct: number;
  gemiddeldeDealCents: number;
};

/** De cijfers voor de KPI-balk op het dashboard (hoofdstuk 8.1). */
export function samenvatting(handle: DatabaseHandle, jaar?: number): PipelineSamenvatting {
  const dit = jaar ?? new Date().getUTCFullYear();

  const open = handle.raw
    .prepare(
      `SELECT COUNT(*) AS aantal,
              COALESCE(SUM(amount_cents), 0) AS bedrag,
              COALESCE(SUM(weighted_amount_cents), 0) AS gewogen
         FROM opportunities WHERE status = 'open' AND archived_at IS NULL`,
    )
    .get() as Rij;

  const afgesloten = handle.raw
    .prepare(
      `SELECT SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS gewonnen,
              SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS verloren,
              COALESCE(SUM(CASE WHEN status = 'won' THEN won_amount_cents ELSE 0 END), 0) AS gescoord
         FROM opportunities
        WHERE archived_at IS NULL AND status IN ('won', 'lost')
          AND SUBSTR(actual_close_date, 1, 4) = ?`,
    )
    .get(String(dit)) as Rij;

  const gewonnen = Number(afgesloten.gewonnen ?? 0);
  const verloren = Number(afgesloten.verloren ?? 0);
  const totaal = gewonnen + verloren;

  return {
    openAantal: Number(open.aantal),
    openCents: Number(open.bedrag),
    gewogenCents: Number(open.gewogen),
    gescoordDitJaarCents: Number(afgesloten.gescoord),
    winRatePct: totaal === 0 ? 0 : Math.round((gewonnen / totaal) * 1000) / 10,
    gemiddeldeDealCents: gewonnen === 0 ? 0 : Math.round(Number(afgesloten.gescoord) / gewonnen),
  };
}
