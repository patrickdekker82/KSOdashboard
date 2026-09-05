/**
 * De signaleringsregels (hoofdstuk 8.2).
 *
 * Eén functie per regeltype uit de seed. Elke functie kijkt naar de gegevens en
 * levert bevindingen op; wat er daarna mee gebeurt, bepaalt de motor.
 *
 * Twee dingen zijn overal hetzelfde gehouden. De `dedupeKey` bevat wat de
 * melding uniek maakt en verder niets — geen datum, geen aantal — want anders
 * is elke controle een nieuwe melding en blijft de lijst groeien. En de tekst
 * zegt wat er aan de hand is én wat het betekent: "week 22 zit op 118%" is een
 * getal, "week 22 zit op 118%, dat is drie afspraken te veel" is een bericht.
 */
import type { CapacitySettings, CapacityWeek } from '@showroom/shared';
import {
  addIsoWeeks,
  formatCurrency,
  formatDate,
  formatDecimal,
  getIsoWeek,
  isoWeekRange,
  toIsoDate,
  type IsoWeek,
} from '@showroom/shared';
import { computeCapacity, findGaps } from '../capacity/engine.ts';
import { loadCapacityInput, readSetting } from '../capacity/repository.ts';
import { verouderdeKansen } from '../opportunities/stages.ts';
import { getal, type Bevinding, type RegelContext, type RegelHandler } from './types.ts';

type Rij = Record<string, unknown>;

/**
 * De weken vanaf nu tot `weken` vooruit, doorgerekend.
 *
 * Geeft de instellingen mee terug: een regel die naar drempels of naar het
 * aantal afspraken per woning kijkt, moet dezelfde waarden gebruiken als de
 * berekening zelf.
 */
function bezetting(
  context: RegelContext,
  weken: number,
): { weeks: CapacityWeek[]; settings: CapacitySettings } {
  const van = getIsoWeek(context.nu);
  const tot = addIsoWeeks(van, Math.max(1, Math.round(weken)) - 1);
  const invoer = loadCapacityInput(context.handle, van, tot);
  return { weeks: computeCapacity(invoer).weeks, settings: invoer.settings };
}

/** "week 22 (2026)" */
function weekLabel(week: IsoWeek): string {
  return `week ${week.week} (${week.year})`;
}

/** De datum van vandaag als ISO, in UTC net als de rest van de rekenkern. */
function vandaag(context: RegelContext): string {
  return toIsoDate(context.nu);
}

/** Een datum die `dagen` verderop ligt. */
function overDagen(context: RegelContext, dagen: number): string {
  return toIsoDate(new Date(context.nu.getTime() + dagen * 86_400_000));
}

// --- capaciteit ------------------------------------------------------------

/** Structurele leegte: de reden dat acquisitie op tijd aan de bak moet. */
const capaciteitsgat: RegelHandler = (context) => {
  const horizon = getal(context.params, 'horizonWeeks', 26);
  const drempel = getal(context.params, 'thresholdPct', 50);
  const minWeken = getal(context.params, 'minConsecutiveWeeks', 3);
  const doorlooptijd = getal(context.params, 'leadTimeWeeks', 8);

  const uitkomst = bezetting(context, horizon);
  const gaten = findGaps(uitkomst.weeks, {
    thresholdPct: drempel,
    minConsecutiveWeeks: minWeken,
    // Dezelfde systeeminstelling als de gatendetectie in de API gebruikt.
    appointmentsPerUnit: readSetting(context.handle, 'appointments_per_unit', 1),
  });

  return gaten.map((gat) => {
    // Hoeveel weken er nog zijn om iets binnen te halen dat op tijd begint.
    const wekenTot = isoWeekRange(getIsoWeek(context.nu), gat.startWeek).length - 1;
    const haalbaar = wekenTot >= doorlooptijd;

    return {
      dedupeKey: `gat:${gat.startWeek.year}-${gat.startWeek.week}`,
      titel: `Showroom loopt leeg vanaf ${weekLabel(gat.startWeek)}`,
      tekst:
        `${gat.weeks} weken op gemiddeld ${formatDecimal(gat.avgUtilisationPct)}% bezetting, ` +
        `tot en met ${weekLabel(gat.endWeek)}. Er is ruimte voor ongeveer ` +
        `${gat.shortfallUnits} woningen extra. ` +
        (haalbaar
          ? `Nog ${wekenTot} weken om iets binnen te halen; de doorlooptijd is ${doorlooptijd} weken.`
          : `Let op: nog maar ${wekenTot} weken tot het zover is, en de doorlooptijd is ${doorlooptijd} weken. ` +
            'Voor deze periode is acquisitie waarschijnlijk te laat.'),
      entiteit: null,
      recordId: null,
      payload: {
        startWeek: gat.startWeek,
        endWeek: gat.endWeek,
        weken: gat.weeks,
        woningen: gat.shortfallUnits,
        opTijd: haalbaar,
      },
    };
  });
};

/** Weken die over de drempel gaan. */
const overbezetting: RegelHandler = (context) => {
  const horizon = getal(context.params, 'horizonWeeks', 12);
  const drempel = getal(context.params, 'thresholdPct', 100);
  const uitkomst = bezetting(context, horizon);

  return uitkomst.weeks
    .filter((week) => week.utilisationPct > drempel)
    .map((week) => {
      const teveel = week.loadTotal - week.capacity;
      return {
        dedupeKey: `overbezet:${week.isoYear}-${week.isoWeek}`,
        titel: `${weekLabel({ year: week.isoYear, week: week.isoWeek })} is overbezet`,
        tekst:
          `${formatDecimal(week.utilisationPct)}% bezetting: ${formatDecimal(week.loadTotal)} ` +
          `afspraken tegen een capaciteit van ${formatDecimal(week.capacity)}. ` +
          `Dat is ${formatDecimal(teveel)} afspraken te veel.`,
        entiteit: null,
        recordId: null,
        payload: { isoYear: week.isoYear, isoWeek: week.isoWeek, bezetting: week.utilisationPct },
      };
    });
};

/**
 * Weken waarin de capaciteit inzakt door verlof of inzet elders.
 *
 * Het verschil met overbezetting: hier is niet het werk toegenomen maar de
 * bezetting afgenomen, en dat vraagt om een ander gesprek.
 */
const teWeinigBezetting: RegelHandler = (context) => {
  const horizon = getal(context.params, 'horizonWeeks', 12);
  const uitkomst = bezetting(context, horizon);

  return uitkomst.weeks
    .filter((week) => {
      if (week.isClosed) return false;
      const verlies = week.capacityIfFullyStaffed - week.capacity;
      // Pas melden als er echt iets wegvalt én de week het niet meer trekt.
      return verlies > 0 && week.loadTotal > week.capacity;
    })
    .map((week) => ({
      dedupeKey: `bezetting:${week.isoYear}-${week.isoWeek}`,
      titel: `${weekLabel({ year: week.isoYear, week: week.isoWeek })} komt krap door afwezigheid`,
      tekst:
        `De capaciteit zakt van ${formatDecimal(week.capacityIfFullyStaffed)} naar ` +
        `${formatDecimal(week.capacity)} afspraken door verlof of inzet elders, terwijl er ` +
        `${formatDecimal(week.loadTotal)} afspraken staan.`,
      entiteit: null,
      recordId: null,
      payload: {
        isoYear: week.isoYear,
        isoWeek: week.isoWeek,
        capaciteit: week.capacity,
        volleBezetting: week.capacityIfFullyStaffed,
      },
    }));
};

/** Te weinig begeleiders tegelijk aanwezig. */
const teWeinigBegeleiders: RegelHandler = (context) => {
  const horizon = getal(context.params, 'horizonWeeks', 12);
  const uitkomst = bezetting(context, horizon);
  const minimum = getal(
    context.params,
    'minGuidesAvailable',
    uitkomst.settings.minGuidesAvailable,
  );

  return uitkomst.weeks
    .filter((week) => !week.isClosed && week.guidesAvailable < minimum)
    .map((week) => ({
      dedupeKey: `begeleiders:${week.isoYear}-${week.isoWeek}`,
      titel: `${weekLabel({ year: week.isoYear, week: week.isoWeek })} heeft te weinig begeleiders`,
      tekst:
        `Er ${week.guidesAvailable === 1 ? 'is' : 'zijn'} ${week.guidesAvailable} ` +
        `begeleider${week.guidesAvailable === 1 ? '' : 's'} beschikbaar; de ondergrens is ${minimum}.` +
        (week.loadTotal > 0
          ? ` Er staan wel ${formatDecimal(week.loadTotal)} afspraken.`
          : ' Er staan geen afspraken.'),
      entiteit: null,
      recordId: null,
      payload: { isoYear: week.isoYear, isoWeek: week.isoWeek, begeleiders: week.guidesAvailable },
    }));
};

/** Verlofaanvragen die een week over de drempel duwen. */
const verlofConflict: RegelHandler = (context) => {
  const horizon = getal(context.params, 'horizonWeeks', 12);
  const uitkomst = bezetting(context, horizon);
  const drempel = uitkomst.settings.thresholds.orange * 100;

  const aanvragen = context.handle.raw
    .prepare(
      `SELECT a.id, a.start_date, a.end_date, u.name, u.initials
         FROM absences a
         JOIN users u ON u.id = a.user_id
         JOIN absence_types t ON t.id = a.absence_type_id
        WHERE a.status = 'aangevraagd' AND a.archived_at IS NULL
          AND t.reduces_capacity = 1
          AND a.start_date >= ?`,
    )
    .all(vandaag(context)) as Rij[];

  const bevindingen: Bevinding[] = [];

  for (const aanvraag of aanvragen) {
    const start = String(aanvraag.start_date);
    const eind = aanvraag.end_date === null ? start : String(aanvraag.end_date);

    const geraakt = uitkomst.weeks.filter(
      (week) => start <= week.endDate && eind >= week.startDate && week.utilisationPct > drempel,
    );
    if (geraakt.length === 0) continue;

    bevindingen.push({
      dedupeKey: `verlofconflict:${String(aanvraag.id)}`,
      titel: `Verlofaanvraag van ${String(aanvraag.initials)} valt in een drukke week`,
      tekst:
        `${String(aanvraag.name)} vraagt vrij van ${formatDate(start)} tot en met ` +
        `${formatDate(eind)}. In die periode ${geraakt.length === 1 ? 'zit' : 'zitten'} ` +
        `${geraakt.map((week) => weekLabel({ year: week.isoYear, week: week.isoWeek })).join(', ')} ` +
        `al boven de ${formatDecimal(drempel)}%.`,
      entiteit: 'absences',
      recordId: Number(aanvraag.id),
      payload: { weken: geraakt.map((week) => ({ jaar: week.isoYear, week: week.isoWeek })) },
    });
  }

  return bevindingen;
};

/** Goed nieuws: iemand komt weer beschikbaar. */
const inzetLooptAf: RegelHandler = (context) => {
  const dagen = getal(context.params, 'daysAhead', 21);

  const rijen = context.handle.raw
    .prepare(
      `SELECT c.id, c.title, c.end_date, c.allocation_mode, c.allocation_value,
              u.name, u.initials
         FROM capacity_allocations c
         JOIN users u ON u.id = c.user_id
        WHERE c.archived_at IS NULL
          AND c.status IN ('gepland', 'actief')
          AND c.end_date BETWEEN ? AND ?`,
    )
    .all(vandaag(context), overDagen(context, dagen)) as Rij[];

  return rijen.map((rij) => ({
    dedupeKey: `inzetaf:${String(rij.id)}`,
    titel: `${String(rij.initials)} komt weer beschikbaar`,
    tekst:
      `"${String(rij.title)}" loopt af op ${formatDate(String(rij.end_date))}. ` +
      `${String(rij.name)} is daarna weer volledig inzetbaar voor de showroom. ` +
      'Dat is het moment om extra werk in te plannen.',
    entiteit: 'capacity-allocations',
    recordId: Number(rij.id),
    payload: { einddatum: rij.end_date },
  }));
};

// --- afwezigheid -----------------------------------------------------------

/** Ziekmeldingen zonder einddatum die te lang open staan. */
const openZiekmelding: RegelHandler = (context) => {
  const dagen = getal(context.params, 'days', 7);
  const grens = overDagen(context, -dagen);

  const rijen = context.handle.raw
    .prepare(
      `SELECT a.id, a.start_date, u.name, u.initials
         FROM absences a
         JOIN users u ON u.id = a.user_id
         JOIN absence_types t ON t.id = a.absence_type_id
        WHERE a.archived_at IS NULL
          AND a.status = 'goedgekeurd'
          AND a.end_date IS NULL
          AND t.reduces_capacity = 1
          AND a.start_date <= ?`,
    )
    .all(grens) as Rij[];

  return rijen.map((rij) => ({
    dedupeKey: `ziek:${String(rij.id)}`,
    // De aard van de ziekte staat hier bewust niet, en nergens anders ook niet.
    titel: `${String(rij.initials)} staat al langer dan ${dagen} dagen afwezig`,
    tekst:
      `De afwezigheid van ${String(rij.name)} loopt sinds ${formatDate(String(rij.start_date))} ` +
      'en heeft nog geen einddatum. Zolang die ontbreekt, rekent de planning met een open einde. ' +
      'Vul een verwachte einddatum in zodra die bekend is.',
    entiteit: 'absences',
    recordId: Number(rij.id),
    payload: { sinds: rij.start_date },
  }));
};

// --- projecten -------------------------------------------------------------

/** Projecten zonder showroomfase geven geen belasting en vallen dus buiten beeld. */
const projectZonderPlanning: RegelHandler = (context) => {
  const rijen = context.handle.raw
    .prepare(
      `SELECT p.id, p.name, p.number, p.unit_count
         FROM projects p
        WHERE p.archived_at IS NULL
          AND p.counts_as_showroom = 1
          AND p.unit_count > 0
          AND NOT EXISTS (
            SELECT 1 FROM project_phases f
             WHERE f.project_id = p.id AND f.archived_at IS NULL AND f.is_capacity_load = 1
          )`,
    )
    .all() as Rij[];

  return rijen.map((rij) => ({
    dedupeKey: `ongepland:${String(rij.id)}`,
    titel: `"${String(rij.name)}" heeft geen showroomplanning`,
    tekst:
      `Dit project telt ${Number(rij.unit_count)} woningen maar heeft geen fase die de planning ` +
      'belast. Het staat dus nergens in de bezetting, en de weken die het zou vullen lijken leeg.',
    entiteit: 'projects',
    recordId: Number(rij.id),
    payload: { woningen: rij.unit_count },
  }));
};

/** Een showroomfase die begint zonder dat er een begeleider op zit. */
const projectZonderBegeleider: RegelHandler = (context) => {
  const dagen = getal(context.params, 'daysBefore', 60);

  const rijen = context.handle.raw
    .prepare(
      `SELECT p.id, p.name, f.start_date
         FROM project_phases f
         JOIN projects p ON p.id = f.project_id
        WHERE f.archived_at IS NULL AND p.archived_at IS NULL
          AND f.is_capacity_load = 1
          AND f.start_date BETWEEN ? AND ?
          AND NOT EXISTS (
            SELECT 1 FROM project_assignments a
             WHERE a.project_id = p.id AND a.archived_at IS NULL
          )
        GROUP BY p.id`,
    )
    .all(vandaag(context), overDagen(context, dagen)) as Rij[];

  return rijen.map((rij) => ({
    dedupeKey: `zonderbegeleider:${String(rij.id)}`,
    titel: `"${String(rij.name)}" start zonder begeleider`,
    tekst:
      `De showroomfase begint op ${formatDate(String(rij.start_date))} en er is nog niemand aan ` +
      'gekoppeld. Zonder koppeling telt het werk wel mee in de totale belasting, maar bij ' +
      'niemand persoonlijk.',
    entiteit: 'projects',
    recordId: Number(rij.id),
    payload: { start: rij.start_date },
  }));
};

/**
 * Een lopend project met één begeleider die er in die periode niet is.
 *
 * Dit is het geval waar de klant voor een dichte deur staat: het project heeft
 * geen tweede naam om op terug te vallen.
 */
const projectEnkeleBegeleider: RegelHandler = (context) => {
  const rijen = context.handle.raw
    .prepare(
      `SELECT p.id, p.name, f.start_date, f.end_date, u.name AS begeleider, u.initials,
              a.start_date AS afwezig_van, a.end_date AS afwezig_tot
         FROM project_phases f
         JOIN projects p ON p.id = f.project_id
         JOIN project_assignments pa ON pa.project_id = p.id AND pa.archived_at IS NULL
         JOIN users u ON u.id = pa.user_id
         JOIN absences a ON a.user_id = u.id AND a.archived_at IS NULL
                        AND a.status = 'goedgekeurd'
         JOIN absence_types t ON t.id = a.absence_type_id AND t.reduces_capacity = 1
        WHERE f.archived_at IS NULL AND p.archived_at IS NULL
          AND f.is_capacity_load = 1
          AND f.end_date >= ?
          AND a.start_date <= f.end_date
          AND (a.end_date IS NULL OR a.end_date >= f.start_date)
          AND (SELECT COUNT(*) FROM project_assignments x
                WHERE x.project_id = p.id AND x.archived_at IS NULL) = 1
        -- Eén melding per project. Twee overlappende afwezigheden zijn niet
        -- twee problemen; het probleem is dat er niemand anders is.
        GROUP BY p.id
        HAVING a.start_date = MIN(a.start_date)`,
    )
    .all(vandaag(context)) as Rij[];

  return rijen.map((rij) => ({
    dedupeKey: `enkelebegeleider:${String(rij.id)}`,
    titel: `"${String(rij.name)}" heeft alleen ${String(rij.initials)}, en die is afwezig`,
    tekst:
      `De showroomfase loopt van ${formatDate(String(rij.start_date))} tot en met ` +
      `${formatDate(String(rij.end_date))}. ${String(rij.begeleider)} is in die periode weg ` +
      `(vanaf ${formatDate(String(rij.afwezig_van))}` +
      `${rij.afwezig_tot === null ? ', zonder einddatum' : ` tot en met ${formatDate(String(rij.afwezig_tot))}`}) ` +
      'en er is geen tweede begeleider aan dit project gekoppeld.',
    entiteit: 'projects',
    recordId: Number(rij.id),
    payload: { begeleider: rij.initials },
  }));
};

// --- kansen en offertes ----------------------------------------------------

/** Kansen die te lang stilstaan; de grens komt van de fase zelf. */
const kansStaatStil: RegelHandler = (context) =>
  verouderdeKansen(context.handle, context.nu).map((kans) => ({
    dedupeKey: `stil:${kans.id}`,
    titel: `"${kans.name}" staat ${kans.dagenStil} dagen stil`,
    tekst:
      `De kans staat in "${kans.stage}", waar ${kans.rottingDays} dagen de grens is. ` +
      `Er gaat ${formatCurrency(kans.amountCents)} in om` +
      `${kans.eigenaar ? `, eigenaar is ${kans.eigenaar}` : ''}.`,
    entiteit: 'opportunities',
    recordId: kans.id,
    payload: { dagenStil: kans.dagenStil, grens: kans.rottingDays },
  }));

/** Kansen waarvan de verwachte sluitdatum nadert. */
const sluitdatumNadert: RegelHandler = (context) => {
  const dagen = getal(context.params, 'daysAhead', 14);

  const rijen = context.handle.raw
    .prepare(
      `SELECT k.id, k.name, k.expected_close_date, k.amount_cents, u.name AS eigenaar
         FROM opportunities k
    LEFT JOIN users u ON u.id = k.owner_user_id
        WHERE k.archived_at IS NULL AND k.status = 'open'
          AND k.expected_close_date BETWEEN ? AND ?`,
    )
    .all(vandaag(context), overDagen(context, dagen)) as Rij[];

  return rijen.map((rij) => ({
    dedupeKey: `sluit:${String(rij.id)}`,
    titel: `"${String(rij.name)}" zou binnenkort rond moeten zijn`,
    tekst:
      `De verwachte sluitdatum is ${formatDate(String(rij.expected_close_date))} en de kans staat ` +
      `nog open. Er gaat ${formatCurrency(Number(rij.amount_cents))} in om` +
      `${rij.eigenaar ? `, eigenaar is ${String(rij.eigenaar)}` : ''}.`,
    entiteit: 'opportunities',
    recordId: Number(rij.id),
    payload: { sluitdatum: rij.expected_close_date },
  }));
};

/** Verstuurde offertes waar niets op terugkomt. */
const offerteZonderReactie: RegelHandler = (context) => {
  const dagen = getal(context.params, 'days', 7);

  const rijen = context.handle.raw
    .prepare(
      `SELECT q.id, q.number, q.sent_at, q.total_cents, o.name AS klant
         FROM package_quotes q
    LEFT JOIN organizations o ON o.id = q.organization_id
        WHERE q.archived_at IS NULL
          AND q.status = 'verstuurd'
          AND q.decided_at IS NULL
          AND q.sent_at IS NOT NULL
          AND date(q.sent_at) <= ?`,
    )
    .all(overDagen(context, -dagen)) as Rij[];

  return rijen.map((rij) => ({
    dedupeKey: `offertestil:${String(rij.id)}`,
    titel: `Offerte ${String(rij.number ?? rij.id)} wacht op antwoord`,
    tekst:
      `Verstuurd op ${formatDate(String(rij.sent_at).slice(0, 10))} aan ` +
      `${String(rij.klant ?? 'onbekende klant')}, ${formatCurrency(Number(rij.total_cents))}. ` +
      `Er is al ${dagen} dagen niets op teruggekomen.`,
    entiteit: 'package-quotes',
    recordId: Number(rij.id),
    payload: { verstuurd: rij.sent_at },
  }));
};

/** Offertes waarvan de geldigheid afloopt. */
const offerteVerloopt: RegelHandler = (context) => {
  const dagen = getal(context.params, 'days', 7);

  const rijen = context.handle.raw
    .prepare(
      `SELECT q.id, q.number, q.valid_until, q.total_cents, o.name AS klant
         FROM package_quotes q
    LEFT JOIN organizations o ON o.id = q.organization_id
        WHERE q.archived_at IS NULL
          AND q.decided_at IS NULL
          AND q.valid_until BETWEEN ? AND ?`,
    )
    .all(vandaag(context), overDagen(context, dagen)) as Rij[];

  return rijen.map((rij) => ({
    dedupeKey: `offerteverloopt:${String(rij.id)}`,
    titel: `Offerte ${String(rij.number ?? rij.id)} verloopt binnenkort`,
    tekst:
      `Geldig tot ${formatDate(String(rij.valid_until))} voor ` +
      `${String(rij.klant ?? 'onbekende klant')}, ${formatCurrency(Number(rij.total_cents))}. ` +
      'Verleng hem of neem contact op voordat hij vervalt.',
    entiteit: 'package-quotes',
    recordId: Number(rij.id),
    payload: { geldigTot: rij.valid_until },
  }));
};

// --- opvolging -------------------------------------------------------------

/** Taken en afspraken waarvan de datum voorbij is. */
const opvolgingTeLaat: RegelHandler = (context) => {
  const rijen = context.handle.raw
    .prepare(
      `SELECT a.id, a.subject, a.due_at, a.type, u.name AS eigenaar, u.initials
         FROM activities a
    LEFT JOIN users u ON u.id = a.assigned_user_id
        WHERE a.archived_at IS NULL
          AND a.status = 'open'
          AND a.completed_at IS NULL
          AND a.due_at IS NOT NULL
          AND date(a.due_at) < ?`,
    )
    .all(vandaag(context)) as Rij[];

  return rijen.map((rij) => ({
    dedupeKey: `opvolging:${String(rij.id)}`,
    titel: `"${String(rij.subject)}" staat over datum`,
    tekst:
      `Deze ${String(rij.type)} stond gepland voor ${formatDate(String(rij.due_at).slice(0, 10))}` +
      `${rij.eigenaar ? ` bij ${String(rij.eigenaar)}` : ''} en is nog niet afgerond.`,
    entiteit: 'activities',
    recordId: Number(rij.id),
    payload: { vervaldatum: rij.due_at },
  }));
};

/** Klanten waar al lang niets mee gebeurd is. */
const slapendContact: RegelHandler = (context) => {
  const dagen = getal(context.params, 'days', 180);
  const grens = overDagen(context, -dagen);

  // De laatste-contactdatum komt uit een subquery, en daar kan pas buitenom op
  // gefilterd worden: HAVING hoort bij GROUP BY en dat is hier niet aan de orde.
  const rijen = context.handle.raw
    .prepare(
      `SELECT * FROM (
         SELECT o.id, o.name,
                (SELECT MAX(a.created_at)
                   FROM activity_links l
                   JOIN activities a ON a.id = l.activity_id
                  WHERE l.entity_key = 'organizations' AND l.record_id = o.id) AS laatste
           FROM organizations o
          WHERE o.archived_at IS NULL
            AND EXISTS (
              SELECT 1 FROM projects p WHERE p.organization_id = o.id AND p.archived_at IS NULL
            )
       )
       WHERE laatste IS NULL OR date(laatste) < ?`,
    )
    .all(grens) as Rij[];

  return rijen.map((rij) => ({
    dedupeKey: `slapend:${String(rij.id)}`,
    titel: `Lang geen contact met ${String(rij.name)}`,
    tekst:
      rij.laatste === null
        ? `Er staat geen enkel contactmoment vastgelegd, terwijl er wel projecten lopen.`
        : `Het laatste contactmoment is van ${formatDate(String(rij.laatste).slice(0, 10))}, ` +
          `meer dan ${dagen} dagen geleden.`,
    entiteit: 'organizations',
    recordId: Number(rij.id),
    payload: { laatste: rij.laatste },
  }));
};

// --- datakwaliteit ---------------------------------------------------------

/**
 * Gegevens die de rekenkern in de war sturen.
 *
 * Bewust één melding per soort en niet per record: twintig losse meldingen over
 * ontbrekende woningaantallen leest niemand, één melding met het aantal erbij
 * wel.
 */
const datakwaliteit: RegelHandler = (context) => {
  const bevindingen: Bevinding[] = [];

  const tel = (sql: string, ...parameters: unknown[]): number =>
    Number((context.handle.raw.prepare(sql).get(...(parameters as never[])) as { aantal: number }).aantal);

  const zonderWoningen = tel(
    `SELECT COUNT(*) AS aantal FROM projects
      WHERE archived_at IS NULL AND counts_as_showroom = 1 AND unit_count = 0`,
  );
  if (zonderWoningen > 0) {
    bevindingen.push({
      dedupeKey: 'kwaliteit:woningen',
      titel: `${zonderWoningen} project${zonderWoningen === 1 ? '' : 'en'} zonder aantal woningen`,
      tekst:
        'Zonder aantal woningen levert een project geen belasting op en valt het uit de ' +
        'bezetting. Vul het aantal in, of zet "telt mee als showroomwerk" uit.',
      entiteit: 'projects',
      recordId: null,
      payload: { aantal: zonderWoningen },
    });
  }

  const zonderRooster = tel(
    `SELECT COUNT(*) AS aantal FROM users u
      WHERE u.archived_at IS NULL AND u.active = 1 AND u.is_kopersbegeleider = 1
        AND NOT EXISTS (
          SELECT 1 FROM work_schedules w WHERE w.user_id = u.id AND w.archived_at IS NULL
        )`,
  );
  if (zonderRooster > 0) {
    bevindingen.push({
      dedupeKey: 'kwaliteit:rooster',
      titel: `${zonderRooster} begeleider${zonderRooster === 1 ? '' : 's'} zonder rooster`,
      tekst:
        'Zonder rooster telt iemand voor nul uur mee in de capaciteit. Leg het werkrooster vast ' +
        'bij de medewerker.',
      entiteit: 'users',
      recordId: null,
      payload: { aantal: zonderRooster },
    });
  }

  const jaar = context.nu.getUTCFullYear();
  const feestdagen = tel('SELECT COUNT(*) AS aantal FROM holidays WHERE year = ?', jaar);
  if (feestdagen === 0) {
    bevindingen.push({
      dedupeKey: `kwaliteit:feestdagen:${jaar}`,
      titel: `Geen feestdagen bekend voor ${jaar}`,
      tekst:
        'De planning rekent dan met volle weken rond Pasen, Hemelvaart en Kerst. ' +
        'Genereer de feestdagen bij de instellingen.',
      entiteit: null,
      recordId: null,
      payload: { jaar },
    });
  }

  const zonderKlant = tel(
    `SELECT COUNT(*) AS aantal FROM projects
      WHERE archived_at IS NULL AND organization_id IS NULL`,
  );
  if (zonderKlant > 0) {
    bevindingen.push({
      dedupeKey: 'kwaliteit:klant',
      titel: `${zonderKlant} project${zonderKlant === 1 ? '' : 'en'} zonder klant`,
      tekst:
        'Deze projecten zijn niet aan een organisatie gekoppeld, waardoor ze niet meelopen in de ' +
        'rapportage per klant. Vaak komen ze uit een import waar de naam niet werd herkend.',
      entiteit: 'projects',
      recordId: null,
      payload: { aantal: zonderKlant },
    });
  }

  return bevindingen;
};

/**
 * De regels die de motor kent, op het `type` uit `alert_rules`.
 *
 * Een regel waarvan het type hier niet in staat, wordt overgeslagen en bij naam
 * teruggegeven door de motor. Zo blijft zichtbaar dat hij bestaat maar nog
 * niets doet, in plaats van dat hij stilletjes nooit afgaat.
 */
export const REGELS = new Map<string, RegelHandler>([
  ['capacity_gap', capaciteitsgat],
  ['capacity_overload', overbezetting],
  ['capacity_understaffed', teWeinigBezetting],
  ['absence_conflict', verlofConflict],
  ['absence_overlap', teWeinigBegeleiders],
  ['allocation_ending', inzetLooptAf],
  ['sick_leave_open', openZiekmelding],
  ['project_single_guide', projectEnkeleBegeleider],
  ['project_unplanned', projectZonderPlanning],
  ['project_phase_missing', projectZonderBegeleider],
  ['opportunity_stale', kansStaatStil],
  ['opportunity_closing', sluitdatumNadert],
  ['quote_no_response', offerteZonderReactie],
  ['quote_expiring', offerteVerloopt],
  ['followup_overdue', opvolgingTeLaat],
  ['contact_dormant', slapendContact],
  ['data_quality', datakwaliteit],
  // `backup_failed` staat bewust niet in deze lijst: er worden nog geen
  // back-uploops vastgelegd. Die regel gaat pas iets doen in fase 12.
]);
