/**
 * De motor achter de signaleringen (hoofdstuk 8.2).
 *
 * Regels leveren bevindingen; deze module bepaalt wat dat betekent voor de
 * meldingen die er al staan:
 *
 *   - een bevinding die nog niet als open melding bestaat  → nieuwe melding
 *   - een bevinding die al openstaat                       → laatst gezien bij
 *   - een open melding zonder bevinding                    → opgelost
 *
 * Dat laatste is het punt waar het meestal misgaat. Een systeem dat alleen
 * meldingen aanmaakt en nooit sluit, wordt binnen een maand genegeerd. Een week
 * die weer onder de drempel zakt hoort vanzelf uit de lijst te verdwijnen,
 * zonder dat iemand op een kruisje klikt.
 *
 * Er is per situatie hooguit één melding: `alerts.dedupe_key` heeft een unieke
 * index. Komt een eerder opgeloste situatie terug, dan wordt diezelfde melding
 * heropend en gaat "voor het eerst gezien" op dat moment — het probleem is
 * immers opnieuw begonnen, en "speelt al sinds maart" zou onwaar zijn voor iets
 * dat er in april niet was. Een bevestiging of uitstel van de vorige keer
 * vervalt daarbij, want die ging over het vorige voorval.
 *
 * De sleutel krijgt het regeltype als voorvoegsel. Zonder dat zouden twee
 * regels die allebei "kwaliteit:klant" gebruiken elkaars melding overschrijven,
 * en de unieke index maakt dat een harde fout in plaats van een subtiele.
 */
import type { DatabaseHandle } from '../../db/client.ts';
import { REGELS } from './rules.ts';
import type { Bevinding, Ernst } from './types.ts';

type Rij = Record<string, unknown>;

export type RegelUitkomst = {
  regelId: number;
  naam: string;
  type: string;
  nieuw: number;
  bijgewerkt: number;
  opgelost: number;
  /** Gevuld als de regel omviel; de andere regels draaien gewoon door. */
  fout?: string;
};

export type ControleUitkomst = {
  gedraaid: number;
  nieuw: number;
  bijgewerkt: number;
  opgelost: number;
  regels: RegelUitkomst[];
  /** Regeltypes die in de database staan maar nog geen code hebben. */
  onbekendeTypes: string[];
};

/**
 * Draait alle actieve regels en werkt de meldingen bij.
 *
 * Elke regel draait in zijn eigen transactie: valt er één om — een fout in een
 * query, een rare parameter — dan blijven de andere gewoon werken en staat er
 * in de uitkomst wat er misging. Een dashboard dat leeg blijft omdat één regel
 * struikelt, is erger dan een dashboard met zeventien van de achttien regels.
 */
export function voerControleUit(
  handle: DatabaseHandle,
  nu = new Date(),
  alleenRegelId?: number,
): ControleUitkomst {
  const regels = handle.raw
    .prepare(
      `SELECT id, name, type, params, severity FROM alert_rules
        WHERE active = 1 AND archived_at IS NULL ${alleenRegelId ? 'AND id = ?' : ''}
        ORDER BY id`,
    )
    .all(...((alleenRegelId ? [alleenRegelId] : []) as never[])) as Rij[];

  const uitkomsten: RegelUitkomst[] = [];
  const onbekendeTypes: string[] = [];

  for (const regel of regels) {
    const type = String(regel.type);
    const handler = REGELS.get(type);
    if (!handler) {
      onbekendeTypes.push(type);
      continue;
    }

    const regelId = Number(regel.id);
    const ernst = String(regel.severity) as Ernst;

    try {
      const bevindingen = handler({ handle, params: veiligeParams(regel.params), nu });
      const uitkomst = verwerk(handle, regelId, String(regel.name), type, ernst, bevindingen, nu);
      uitkomsten.push(uitkomst);
    } catch (error) {
      uitkomsten.push({
        regelId,
        naam: String(regel.name),
        type,
        nieuw: 0,
        bijgewerkt: 0,
        opgelost: 0,
        fout: error instanceof Error ? error.message : String(error),
      });
    }

    handle.raw
      .prepare("UPDATE alert_rules SET last_checked_at = datetime('now') WHERE id = ?")
      .run(regelId);
  }

  return {
    gedraaid: uitkomsten.length,
    nieuw: uitkomsten.reduce((som, regel) => som + regel.nieuw, 0),
    bijgewerkt: uitkomsten.reduce((som, regel) => som + regel.bijgewerkt, 0),
    opgelost: uitkomsten.reduce((som, regel) => som + regel.opgelost, 0),
    regels: uitkomsten,
    onbekendeTypes,
  };
}

/** Zet de bevindingen van één regel om in meldingen. */
function verwerk(
  handle: DatabaseHandle,
  regelId: number,
  naam: string,
  type: string,
  ernst: Ernst,
  bevindingen: readonly Bevinding[],
  nu: Date,
): RegelUitkomst {
  const tijdstempel = nu.toISOString().slice(0, 19).replace('T', ' ');

  // Alles wat deze regel ooit heeft gemeld, opgeloste meldingen inbegrepen:
  // die kunnen heropend moeten worden.
  const bestaand = new Map<string, Rij>();
  for (const rij of handle.raw
    .prepare('SELECT * FROM alerts WHERE rule_id = ?')
    .all(regelId) as Rij[]) {
    bestaand.set(String(rij.dedupe_key), rij);
  }

  let nieuw = 0;
  let bijgewerkt = 0;
  const gezien = new Set<string>();

  handle.raw.exec('BEGIN');
  try {
    for (const bevinding of bevindingen) {
      const sleutel = `${type}:${bevinding.dedupeKey}`;
      // Levert een regel dezelfde sleutel twee keer, dan is het dezelfde
      // melding en wint de eerste. Zonder dit zou de unieke index de hele regel
      // laten omvallen om iets wat geen echt probleem is.
      if (gezien.has(sleutel)) continue;
      gezien.add(sleutel);
      const huidig = bestaand.get(sleutel);

      if (huidig && String(huidig.status) === 'opgelost') {
        // Heropenen: het probleem is opnieuw begonnen, dus de teller loopt
        // vanaf nu en een eerdere bevestiging telt niet meer.
        handle.raw
          .prepare(
            `UPDATE alerts
                SET title = ?, body = ?, severity = ?, status = 'open',
                    first_seen_at = ?, last_seen_at = ?, payload = ?,
                    acknowledged_by = NULL, acknowledged_at = NULL, snoozed_until = NULL
              WHERE id = ?`,
          )
          .run(
            bevinding.titel,
            bevinding.tekst,
            ernst,
            tijdstempel,
            tijdstempel,
            JSON.stringify(bevinding.payload ?? {}),
            Number(huidig.id),
          );
        nieuw += 1;
        continue;
      }

      if (huidig) {
        // De tekst kan veranderd zijn — een week die van 105% naar 118% gaat —
        // maar het is dezelfde melding. Alleen bijwerken, niet opnieuw melden.
        handle.raw
          .prepare(
            `UPDATE alerts
                SET title = ?, body = ?, severity = ?, last_seen_at = ?, payload = ?
              WHERE id = ?`,
          )
          .run(
            bevinding.titel,
            bevinding.tekst,
            ernst,
            tijdstempel,
            JSON.stringify(bevinding.payload ?? {}),
            Number(huidig.id),
          );
        bijgewerkt += 1;
        continue;
      }

      handle.raw
        .prepare(
          `INSERT INTO alerts
             (rule_id, title, body, severity, entity_key, record_id, status,
              first_seen_at, last_seen_at, dedupe_key, payload)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
        )
        .run(
          regelId,
          bevinding.titel,
          bevinding.tekst,
          ernst,
          bevinding.entiteit,
          bevinding.recordId,
          tijdstempel,
          tijdstempel,
          sleutel,
          JSON.stringify(bevinding.payload ?? {}),
        );
      nieuw += 1;
    }

    // Wat niet meer gemeld wordt, is opgelost. Al opgeloste meldingen laten we
    // met rust: die staan er als geschiedenis.
    let opgelost = 0;
    for (const [sleutel, rij] of bestaand) {
      if (gezien.has(sleutel) || String(rij.status) === 'opgelost') continue;
      handle.raw
        .prepare("UPDATE alerts SET status = 'opgelost', last_seen_at = ? WHERE id = ?")
        .run(tijdstempel, Number(rij.id));
      opgelost += 1;
    }

    handle.raw.exec('COMMIT');
    return { regelId, naam, type, nieuw, bijgewerkt, opgelost };
  } catch (error) {
    handle.raw.exec('ROLLBACK');
    throw error;
  }
}

/** Parameters uit de database; onleesbare JSON levert lege parameters op. */
function veiligeParams(waarde: unknown): Record<string, unknown> {
  if (typeof waarde !== 'string') return {};
  try {
    const ontleed = JSON.parse(waarde) as unknown;
    return ontleed !== null && typeof ontleed === 'object'
      ? (ontleed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export type MeldingFilter = {
  /** Standaard alleen wat aandacht vraagt: open en bevestigd. */
  status?: string[];
  ernst?: Ernst[];
  /** Uitgestelde meldingen waarvan de datum nog niet is verstreken weglaten. */
  verbergUitgesteld?: boolean;
  limiet?: number;
};

/** De meldingen voor het dashboard. */
export function laadMeldingen(
  handle: DatabaseHandle,
  filter: MeldingFilter = {},
  nu = new Date(),
): Rij[] {
  const status = filter.status ?? ['open', 'bevestigd', 'uitgesteld'];
  const ernst = filter.ernst ?? ['info', 'let_op', 'urgent'];
  const tijdstempel = nu.toISOString().slice(0, 19).replace('T', ' ');

  const voorwaarden = [
    `a.status IN (${status.map(() => '?').join(', ')})`,
    `a.severity IN (${ernst.map(() => '?').join(', ')})`,
  ];
  const parameters: unknown[] = [...status, ...ernst];

  if (filter.verbergUitgesteld !== false) {
    voorwaarden.push("(a.snoozed_until IS NULL OR a.snoozed_until <= ?)");
    parameters.push(tijdstempel);
  }

  parameters.push(filter.limiet ?? 200);

  return handle.raw
    .prepare(
      `SELECT a.*, r.name AS regel, r.type AS regeltype, u.name AS bevestigd_door
         FROM alerts a
    LEFT JOIN alert_rules r ON r.id = a.rule_id
    LEFT JOIN users u ON u.id = a.acknowledged_by
        WHERE ${voorwaarden.join(' AND ')}
        ORDER BY CASE a.severity WHEN 'urgent' THEN 0 WHEN 'let_op' THEN 1 ELSE 2 END,
                 a.first_seen_at DESC
        LIMIT ?`,
    )
    .all(...(parameters as never[])) as Rij[];
}

/** Hoeveel er per ernst openstaat, voor het bolletje in de kopbalk. */
export function telMeldingen(handle: DatabaseHandle, nu = new Date()): Record<Ernst, number> {
  const rijen = laadMeldingen(handle, { status: ['open', 'bevestigd'] }, nu);
  const telling: Record<Ernst, number> = { urgent: 0, let_op: 0, info: 0 };
  for (const rij of rijen) {
    const ernst = String(rij.severity) as Ernst;
    if (ernst in telling) telling[ernst] += 1;
  }
  return telling;
}
