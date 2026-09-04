/**
 * Tests voor het verlofsaldo (hoofdstuk 6.4.4).
 *
 * Dit is rekenwerk in uren over kalenderdagen, en dat is precies waar het
 * misgaat: een parttimer die op woensdag vrij is, een halve dag aan het begin
 * van een reeks, een feestdag midden in een vakantie, en verlof dat over de
 * jaargrens loopt. Elk van die gevallen staat hieronder.
 */
import { describe, expect, it } from 'vitest';
import type { DayHours, HolidayInput, WorkScheduleInput } from '@showroom/shared';
import { berekenOpname, berekenSaldo, type VerlofAfwezigheid } from './balance.ts';

/** Voltijd: acht uur van maandag tot en met vrijdag. */
const VOLTIJD: WorkScheduleInput = {
  validFrom: '2020-01-01',
  validTo: null,
  dayHours: [8, 8, 8, 8, 8, 0, 0] as DayHours,
  appointmentsPerWeek: 15,
};

/** Vier dagen: woensdag vrij. */
const VIERDAAGS: WorkScheduleInput = {
  validFrom: '2020-01-01',
  validTo: null,
  dayHours: [8, 8, 0, 8, 8, 0, 0] as DayHours,
  appointmentsPerWeek: 12,
};

function verlof(overschrijving: Partial<VerlofAfwezigheid> = {}): VerlofAfwezigheid {
  return {
    start: '2026-06-01',
    end: '2026-06-05',
    dayPart: 'hele_dag',
    hoursOverride: null,
    reducesCapacity: true,
    countsAsLeave: true,
    status: 'goedgekeurd',
    ...overschrijving,
  };
}

describe('opgenomen verlof tellen', () => {
  it('telt een hele werkweek als veertig uur voor een voltijder', () => {
    // maandag 1 t/m vrijdag 5 juni 2026
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof()],
      holidays: [],
    });

    expect(opname.opgenomenUren).toBe(40);
    expect(opname.aangevraagdUren).toBe(0);
  });

  it('slaat de vrije dag van een parttimer over', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VIERDAAGS],
      absences: [verlof()],
      holidays: [],
    });

    // Woensdag werkt deze medewerker niet, dus die kost geen verlof.
    expect(opname.opgenomenUren).toBe(32);
  });

  it('telt het weekend niet mee', () => {
    // vrijdag 5 t/m maandag 8 juni: twee werkdagen, geen zaterdag en zondag
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof({ start: '2026-06-05', end: '2026-06-08' })],
      holidays: [],
    });

    expect(opname.opgenomenUren).toBe(16);
  });

  it('rekent een feestdag midden in de vakantie niet als verlof', () => {
    const feestdagen: HolidayInput[] = [
      { date: '2026-06-03', isDayOff: true, name: 'Verzonnen vrije dag' },
    ];
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof()],
      holidays: feestdagen,
    });

    // Die woensdag was al vrij, dus vier dagen verlof in plaats van vijf.
    expect(opname.opgenomenUren).toBe(32);
  });

  it('telt een dag die wel op de feestdaglijst staat maar niet vrij is gewoon mee', () => {
    const feestdagen: HolidayInput[] = [
      { date: '2026-06-03', isDayOff: false, name: 'Wel werken' },
    ];
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof()],
      holidays: feestdagen,
    });

    expect(opname.opgenomenUren).toBe(40);
  });

  it('rekent een dagdeel alleen op de eerste en laatste dag van de reeks', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof({ start: '2026-06-01', end: '2026-06-03', dayPart: 'ochtend' })],
      holidays: [],
    });

    // 4 + 8 + 4: de dagen ertussen zijn altijd hele dagen.
    expect(opname.opgenomenUren).toBe(16);
  });

  it('rekent een losse halve dag als een halve dag', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof({ start: '2026-06-02', end: '2026-06-02', dayPart: 'middag' })],
      holidays: [],
    });

    expect(opname.opgenomenUren).toBe(4);
  });

  it('gebruikt de uren-override en laat die nooit boven de dag uitkomen', () => {
    const twee = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof({ start: '2026-06-02', end: '2026-06-02', hoursOverride: 2 })],
      holidays: [],
    });
    expect(twee.opgenomenUren).toBe(2);

    const teveel = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof({ start: '2026-06-02', end: '2026-06-02', hoursOverride: 20 })],
      holidays: [],
    });
    expect(teveel.opgenomenUren).toBe(8);
  });

  it('laat ziekte het verlofsaldo ongemoeid', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof({ countsAsLeave: false })],
      holidays: [],
    });

    expect(opname.opgenomenUren).toBe(0);
  });

  it('houdt aangevraagd en goedgekeurd uit elkaar', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [
        verlof({ start: '2026-06-01', end: '2026-06-02' }),
        verlof({ start: '2026-06-08', end: '2026-06-09', status: 'aangevraagd' }),
      ],
      holidays: [],
    });

    expect(opname.opgenomenUren).toBe(16);
    expect(opname.aangevraagdUren).toBe(16);
  });

  it('negeert afgewezen en geannuleerd verlof', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof({ status: 'afgewezen' }), verlof({ status: 'geannuleerd' })],
      holidays: [],
    });

    expect(opname.opgenomenUren).toBe(0);
    expect(opname.aangevraagdUren).toBe(0);
  });

  // Verlof van 28 december tot 3 januari drukt op twee saldi, elk voor het
  // deel dat in dat jaar valt.
  it('knipt verlof over de jaargrens op het jaar', () => {
    const overGrens = verlof({ start: '2026-12-28', end: '2027-01-04' });

    const in2026 = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [overGrens],
      holidays: [],
    });
    // ma 28, di 29, wo 30, do 31 december 2026
    expect(in2026.opgenomenUren).toBe(32);

    const in2027 = berekenOpname({
      jaar: 2027,
      schedules: [VOLTIJD],
      absences: [overGrens],
      holidays: [],
    });
    // vr 1, ma 4 januari 2027 (2 en 3 januari zijn zaterdag en zondag)
    expect(in2027.opgenomenUren).toBe(16);
  });

  it('knipt een afwezigheid zonder einddatum op oudjaar', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof({ start: '2026-12-28', end: null })],
      holidays: [],
    });

    expect(opname.opgenomenUren).toBe(32);
  });

  it('negeert verlof dat helemaal buiten het jaar valt', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [verlof({ start: '2025-06-01', end: '2025-06-05' })],
      holidays: [],
    });

    expect(opname.opgenomenUren).toBe(0);
  });

  it('gebruikt het rooster dat op die dag gold', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [
        { ...VOLTIJD, validTo: '2026-06-02' },
        { ...VIERDAAGS, validFrom: '2026-06-03' },
      ],
      absences: [verlof()],
      holidays: [],
    });

    // ma en di voltijd (16), wo vrij in het nieuwe rooster (0), do en vr acht uur (16)
    expect(opname.opgenomenUren).toBe(32);
  });

  it('telt niets voor iemand zonder rooster', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [],
      absences: [verlof()],
      holidays: [],
    });

    expect(opname.opgenomenUren).toBe(0);
  });

  it('telt meerdere periodes bij elkaar op', () => {
    const opname = berekenOpname({
      jaar: 2026,
      schedules: [VOLTIJD],
      absences: [
        verlof({ start: '2026-06-01', end: '2026-06-05' }),
        verlof({ start: '2026-08-03', end: '2026-08-07' }),
      ],
      holidays: [],
    });

    expect(opname.opgenomenUren).toBe(80);
  });
});

describe('saldo samenstellen', () => {
  const basis = {
    jaar: 2026,
    userId: 1,
    initials: 'DM',
    name: 'Dennis',
    schedules: [VOLTIJD],
    holidays: [] as HolidayInput[],
  };

  it('trekt opgenomen verlof van recht plus overheveling af', () => {
    const saldo = berekenSaldo({
      ...basis,
      entitlementHours: 200,
      carriedOverHours: 16,
      absences: [verlof()],
    });

    expect(saldo.rechtUren).toBe(200);
    expect(saldo.overgeheveldUren).toBe(16);
    expect(saldo.opgenomenUren).toBe(40);
    expect(saldo.resterendUren).toBe(176);
    expect(saldo.vrijTeBestedenUren).toBe(176);
    expect(saldo.rechtVastgelegd).toBe(true);
  });

  // Wat nog op goedkeuring wacht is niet opgenomen, maar wel vergeven: het gaat
  // van "vrij te besteden" af en niet van "resterend".
  it('houdt aangevraagd verlof apart van opgenomen verlof', () => {
    const saldo = berekenSaldo({
      ...basis,
      entitlementHours: 200,
      carriedOverHours: 0,
      absences: [
        verlof({ start: '2026-06-01', end: '2026-06-05' }),
        verlof({ start: '2026-08-03', end: '2026-08-07', status: 'aangevraagd' }),
      ],
    });

    expect(saldo.opgenomenUren).toBe(40);
    expect(saldo.aangevraagdUren).toBe(40);
    expect(saldo.resterendUren).toBe(160);
    expect(saldo.vrijTeBestedenUren).toBe(120);
  });

  it('meldt het als er geen recht is vastgelegd', () => {
    const saldo = berekenSaldo({
      ...basis,
      entitlementHours: null,
      carriedOverHours: null,
      absences: [verlof()],
    });

    expect(saldo.rechtVastgelegd).toBe(false);
    expect(saldo.opgenomenUren).toBe(40);
    expect(saldo.resterendUren).toBe(-40);
  });

  it('laat een tekort als tekort staan in plaats van op nul te blijven', () => {
    const saldo = berekenSaldo({
      ...basis,
      entitlementHours: 24,
      carriedOverHours: 0,
      absences: [verlof()],
    });

    expect(saldo.resterendUren).toBe(-16);
  });

  it('rondt af op kwartieren', () => {
    const bijnaEenUur: WorkScheduleInput = {
      ...VOLTIJD,
      dayHours: [7.3, 0, 0, 0, 0, 0, 0] as DayHours,
    };
    const saldo = berekenSaldo({
      ...basis,
      schedules: [bijnaEenUur],
      entitlementHours: 100,
      carriedOverHours: 0,
      // maandag 1 juni, halve dag: 3,65 uur
      absences: [verlof({ start: '2026-06-01', end: '2026-06-01', dayPart: 'ochtend' })],
    });

    expect(saldo.opgenomenUren).toBe(3.75);
  });
});
