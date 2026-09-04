/**
 * Verlofsaldo per medewerker per jaar (hoofdstuk 6.4.4).
 *
 * Alles rekent in uren, net als de beschikbaarheidsengine. Dat is de enige
 * manier waarop een parttimer, een halve dag en een uren-override in dezelfde
 * som kunnen: "twee dagen verlof" is voor iemand die vier uur op dinsdag werkt
 * iets anders dan voor iemand die er acht draait.
 *
 * De uren per dag komen uit dezelfde functie die de beschikbaarheidsengine
 * gebruikt. Twee eigen implementaties zouden op het eerste randgeval uit elkaar
 * lopen, en dan klopt het saldo niet meer met de planning.
 *
 * Deze module raakt de database niet aan; `repository.ts` levert de invoer aan.
 */
import {
  addDays,
  parseIsoDate,
  toIsoDate,
  isoWeekday,
  type IsoDate,
  type DayHours,
  type HolidayInput,
  type WorkScheduleInput,
} from '@showroom/shared';
import { absenceHoursForDay, hoursForWeekday, scheduleOn } from '../availability/engine.ts';
import type { AbsenceInput } from '@showroom/shared';

/** Een afwezigheid met de vraag die voor het saldo telt: gaat hij van het verlof af? */
export type VerlofAfwezigheid = AbsenceInput & {
  /** `counts_as_leave` van het afwezigheidstype. */
  countsAsLeave: boolean;
};

export type OpnameInvoer = {
  jaar: number;
  schedules: readonly WorkScheduleInput[];
  absences: readonly VerlofAfwezigheid[];
  holidays: readonly HolidayInput[];
};

export type Opname = {
  /** Uren van goedgekeurde afwezigheden die van het verlof afgaan. */
  opgenomenUren: number;
  /** Uren die nog op goedkeuring wachten. */
  aangevraagdUren: number;
};

/** Rondt af op kwartieren; uren met twaalf decimalen leest niemand. */
function afronden(uren: number): number {
  return Math.round(uren * 4) / 4;
}

/**
 * Telt de verlofuren in één kalenderjaar.
 *
 * Een afwezigheid die over de jaargrens loopt telt alleen mee voor het deel dat
 * ín het jaar valt: verlof van 28 december tot 3 januari drukt op twee saldi.
 * Een open einde (een ziekmelding zonder einddatum) wordt geknipt op 31
 * december, anders zou de lus nooit stoppen.
 */
export function berekenOpname(invoer: OpnameInvoer): Opname {
  const eersteDag = `${invoer.jaar}-01-01` as IsoDate;
  const laatsteDag = `${invoer.jaar}-12-31` as IsoDate;

  const vrijeDagen = new Set(
    invoer.holidays.filter((dag) => dag.isDayOff).map((dag) => dag.date),
  );

  let opgenomen = 0;
  let aangevraagd = 0;

  for (const afwezigheid of invoer.absences) {
    // Ziekte gaat niet van het verlofsaldo af; dat bepaalt het type.
    if (!afwezigheid.countsAsLeave) continue;
    if (afwezigheid.status !== 'goedgekeurd' && afwezigheid.status !== 'aangevraagd') continue;

    const start = afwezigheid.start > eersteDag ? afwezigheid.start : eersteDag;
    const einde =
      afwezigheid.end === null || afwezigheid.end > laatsteDag ? laatsteDag : afwezigheid.end;
    if (start > einde) continue;

    const uren = urenTussen(afwezigheid, start, einde, invoer.schedules, vrijeDagen);
    if (afwezigheid.status === 'goedgekeurd') opgenomen += uren;
    else aangevraagd += uren;
  }

  return { opgenomenUren: afronden(opgenomen), aangevraagdUren: afronden(aangevraagd) };
}

/** De verlofuren van één afwezigheid tussen twee datums. */
function urenTussen(
  afwezigheid: VerlofAfwezigheid,
  van: IsoDate,
  tot: IsoDate,
  schedules: readonly WorkScheduleInput[],
  vrijeDagen: ReadonlySet<string>,
): number {
  let totaal = 0;
  let dag = parseIsoDate(van);
  const laatste = parseIsoDate(tot).getTime();

  while (dag.getTime() <= laatste) {
    const datum = toIsoDate(dag);

    // Een feestdag kost geen verlof: die dag was al vrij.
    if (!vrijeDagen.has(datum)) {
      const rooster = scheduleOn(schedules, datum);
      const geplandeUren = rooster
        ? hoursForWeekday(rooster.dayHours as DayHours, isoWeekday(dag))
        : 0;
      totaal += absenceHoursForDay(afwezigheid, geplandeUren, dag);
    }

    dag = addDays(dag, 1);
  }

  return totaal;
}

export type Verlofsaldo = {
  userId: number;
  initials: string;
  name: string;
  jaar: number;
  /** Recht in uren voor dit jaar. */
  rechtUren: number;
  /** Meegenomen uit het vorige jaar. */
  overgeheveldUren: number;
  opgenomenUren: number;
  aangevraagdUren: number;
  /** Recht + overgeheveld - opgenomen. Wat er nog staat. */
  resterendUren: number;
  /** Resterend - aangevraagd. Wat er echt nog vrij te plannen valt. */
  vrijTeBestedenUren: number;
  /** Of er een recht is vastgelegd; zonder recht zegt een saldo niets. */
  rechtVastgelegd: boolean;
};

export type SaldoInvoer = {
  jaar: number;
  userId: number;
  initials: string;
  name: string;
  entitlementHours: number | null;
  carriedOverHours: number | null;
  schedules: readonly WorkScheduleInput[];
  absences: readonly VerlofAfwezigheid[];
  holidays: readonly HolidayInput[];
};

/** Zet recht, overheveling en opname om in één saldo. */
export function berekenSaldo(invoer: SaldoInvoer): Verlofsaldo {
  const { opgenomenUren, aangevraagdUren } = berekenOpname({
    jaar: invoer.jaar,
    schedules: invoer.schedules,
    absences: invoer.absences,
    holidays: invoer.holidays,
  });

  const recht = invoer.entitlementHours ?? 0;
  const overgeheveld = invoer.carriedOverHours ?? 0;
  const resterend = afronden(recht + overgeheveld - opgenomenUren);

  return {
    userId: invoer.userId,
    initials: invoer.initials,
    name: invoer.name,
    jaar: invoer.jaar,
    rechtUren: recht,
    overgeheveldUren: overgeheveld,
    opgenomenUren,
    aangevraagdUren,
    resterendUren: resterend,
    vrijTeBestedenUren: afronden(resterend - aangevraagdUren),
    // Zonder vastgelegd recht is "resterend" geen saldo maar een minstand; het
    // scherm hoort dat te zeggen in plaats van een negatief getal te tonen.
    rechtVastgelegd: invoer.entitlementHours !== null,
  };
}
