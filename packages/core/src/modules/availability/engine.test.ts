import { describe, expect, it } from 'vitest';
import type {
  AbsenceInput,
  AllocationInput,
  ClosureInput,
  DayHours,
  HolidayInput,
  IsoWeek,
  UserCapacityInput,
} from '@showroom/shared';
import { isoWeekOfDate } from '@showroom/shared';
import {
  computeUserWeekAvailability,
  isWeekClosed,
  scheduleOn,
  DEFAULT_AVAILABILITY_OPTIONS,
} from './engine.ts';

// A quiet week without holidays: maandag 9 t/m zondag 15 februari 2026.
const WEEK: IsoWeek = isoWeekOfDate('2026-02-09');
const MONDAY = '2026-02-09';
const TUESDAY = '2026-02-10';
const SUNDAY = '2026-02-15';

const FULLTIME: DayHours = [8, 8, 8, 8, 8, 0, 0]; // 5 x 8 = 40 uur
const PARTTIME: DayHours = [8, 8, 8, 8, 0, 0, 0]; // RB: 4 x 8 = 32 uur

function user(overrides: Partial<UserCapacityInput> = {}): UserCapacityInput {
  return {
    id: 1,
    initials: 'DM',
    schedules: [
      {
        validFrom: '2020-01-01',
        validTo: null,
        dayHours: FULLTIME,
        appointmentsPerWeek: 3,
      },
    ],
    absences: [],
    allocations: [],
    ...overrides,
  };
}

function leave(start: string, end: string, extra: Partial<AbsenceInput> = {}): AbsenceInput {
  return {
    start,
    end,
    dayPart: 'hele_dag',
    reducesCapacity: true,
    status: 'goedgekeurd',
    typeName: 'Verlof',
    ...extra,
  };
}

function allocation(extra: Partial<AllocationInput> = {}): AllocationInput {
  return {
    start: MONDAY,
    end: SUNDAY,
    mode: 'percentage',
    value: 40,
    status: 'actief',
    reducesShowroomCapacity: true,
    title: 'Renovatie Kerkstraat',
    ...extra,
  };
}

const run = (
  u: UserCapacityInput,
  holidays: HolidayInput[] = [],
  closures: ClosureInput[] = [],
) => computeUserWeekAvailability(u, WEEK, holidays, closures, DEFAULT_AVAILABILITY_OPTIONS);

// ---------------------------------------------------------------------------
// Bijlage B2 — de tabel met rekenvoorbeelden, regel voor regel
// ---------------------------------------------------------------------------
describe('bijlage B2 — beschikbaarheid van een fulltimer (5 x 8 uur, 3 afspraken)', () => {
  it('niets bijzonders -> 0 uur weg, factor 1,00, capaciteit 3,00', () => {
    const result = run(user());
    expect(result.baseHours).toBe(40);
    expect(result.baseDays).toBe(5);
    expect(result.occupiedHours).toBe(0);
    expect(result.availabilityFactor).toBe(1);
    expect(result.capacity).toBe(3);
  });

  it('1 dag verlof -> 8 uur weg, factor 0,80, capaciteit 2,40', () => {
    const result = run(user({ absences: [leave(MONDAY, MONDAY)] }));
    expect(result.leaveHours).toBe(8);
    expect(result.occupiedHours).toBe(8);
    expect(result.availabilityFactor).toBe(0.8);
    expect(result.capacity).toBe(2.4);
  });

  it('halve dag verlof -> 4 uur weg, factor 0,90, capaciteit 2,70', () => {
    const result = run(user({ absences: [leave(MONDAY, MONDAY, { dayPart: 'ochtend' })] }));
    expect(result.leaveHours).toBe(4);
    expect(result.availabilityFactor).toBe(0.9);
    expect(result.capacity).toBe(2.7);
  });

  it('Tweede Paasdag -> 8 uur weg, factor 0,80, capaciteit 2,40', () => {
    // Tweede Paasdag 2026 valt op maandag 6 april, in week 2026-W15.
    const easterMonday = '2026-04-06';
    const result = computeUserWeekAvailability(
      user(),
      isoWeekOfDate(easterMonday),
      [{ date: easterMonday, isDayOff: true, name: 'Tweede Paasdag' }],
      [],
    );
    expect(result.baseHours).toBe(40);
    expect(result.holidayHours).toBe(8);
    expect(result.availabilityFactor).toBe(0.8);
    expect(result.capacity).toBe(2.4);
  });

  it('40% inzet elders -> 16 uur weg, factor 0,60, capaciteit 1,80', () => {
    const result = run(user({ allocations: [allocation()] }));
    expect(result.allocationHours).toBe(16);
    expect(result.occupiedHours).toBe(16);
    expect(result.availabilityFactor).toBe(0.6);
    expect(result.capacity).toBe(1.8);
  });

  it('hele week verlof -> 40 uur weg, factor 0,00, capaciteit 0,00', () => {
    const result = run(user({ absences: [leave(MONDAY, SUNDAY)] }));
    expect(result.leaveHours).toBe(40);
    expect(result.availableHours).toBe(0);
    expect(result.availabilityFactor).toBe(0);
    expect(result.capacity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7.2 stap 6 — de dubbeltellingstest
// ---------------------------------------------------------------------------
describe('7.2 stap 6 — dubbeltelling tussen verlof en inzet elders', () => {
  it('40% inzet EN 1 dag verlof -> 16 uur weg (niet 24), factor 0,60', () => {
    // 8 uur verlof + max(0, 16 - 8) = 16 uur. Wie 40% elders zit en een dag
    // verlof heeft, is die week 40% weg, niet 60%.
    const result = run(
      user({ absences: [leave(MONDAY, MONDAY)], allocations: [allocation()] }),
    );
    expect(result.leaveHours).toBe(8);
    expect(result.allocationHours).toBe(16);
    expect(result.occupiedHours).toBe(16);
    expect(result.availableHours).toBe(24);
    expect(result.availabilityFactor).toBe(0.6);
    expect(result.capacity).toBe(1.8);
  });

  it('hele week verlof EN 40% inzet -> 40 uur weg, factor 0,00, nooit negatief', () => {
    const result = run(
      user({ absences: [leave(MONDAY, SUNDAY)], allocations: [allocation()] }),
    );
    expect(result.occupiedHours).toBe(40);
    expect(result.availableHours).toBe(0);
    expect(result.availabilityFactor).toBe(0);
    expect(result.capacity).toBe(0);
  });

  it('beschikbare uren worden nooit negatief bij extreme stapeling', () => {
    const result = run(
      user({
        absences: [leave(MONDAY, SUNDAY), leave(TUESDAY, TUESDAY)],
        allocations: [
          allocation({ value: 100 }),
          allocation({ mode: 'uren_per_week', value: 60, title: 'Beurs' }),
        ],
      }),
    );
    expect(result.availableHours).toBe(0);
    expect(result.availableHours).toBeGreaterThanOrEqual(0);
    expect(result.occupiedHours).toBeLessThanOrEqual(result.baseHours);
  });

  it('overlappende verlofaanvragen tellen een dag maar een keer', () => {
    const result = run(
      user({ absences: [leave(MONDAY, TUESDAY), leave(MONDAY, MONDAY)] }),
    );
    expect(result.leaveHours).toBe(16); // niet 24
  });
});

// ---------------------------------------------------------------------------
// Parttimers
// ---------------------------------------------------------------------------
describe('parttimer RB (4 x 8 uur, 3 afspraken)', () => {
  const rb = () =>
    user({
      id: 3,
      initials: 'RB',
      schedules: [
        { validFrom: '2020-01-01', validTo: null, dayHours: PARTTIME, appointmentsPerWeek: 3 },
      ],
    });

  it('werkt 32 basisuren over 4 dagen', () => {
    const result = run(rb());
    expect(result.baseHours).toBe(32);
    expect(result.baseDays).toBe(4);
    expect(result.availabilityFactor).toBe(1);
  });

  it('een dag verlof -> factor 0,75 en capaciteit 2,25', () => {
    const result = run({ ...rb(), absences: [leave(MONDAY, MONDAY)] });
    expect(result.leaveHours).toBe(8);
    expect(result.availabilityFactor).toBe(0.75); // (32 - 8) / 32
    expect(result.capacity).toBe(2.25);
  });

  it('verlof op een niet-werkdag (vrijdag) kost geen uren', () => {
    const friday = '2026-02-13';
    const result = run({ ...rb(), absences: [leave(friday, friday)] });
    expect(result.leaveHours).toBe(0);
    expect(result.availabilityFactor).toBe(1);
  });

  it('40% inzet elders rekent over 32 uur, niet over 40', () => {
    const result = run({ ...rb(), allocations: [allocation()] });
    expect(result.allocationHours).toBeCloseTo(12.8, 5); // 32 x 0,40
    expect(result.availabilityFactor).toBe(0.6);
  });
});

// ---------------------------------------------------------------------------
// Inzet elders — de drie omvangmodi en pro rata
// ---------------------------------------------------------------------------
describe('inzet elders', () => {
  it('dagen_per_week rekent met de gemiddelde dagduur van het rooster', () => {
    const result = run(
      user({ allocations: [allocation({ mode: 'dagen_per_week', value: 2 })] }),
    );
    expect(result.allocationHours).toBe(16); // 2 x (40 / 5)
    expect(result.availabilityFactor).toBe(0.6);
  });

  it('uren_per_week neemt de waarde recht over', () => {
    const result = run(
      user({ allocations: [allocation({ mode: 'uren_per_week', value: 8 })] }),
    );
    expect(result.allocationHours).toBe(8);
    expect(result.availabilityFactor).toBe(0.8);
  });

  it('rekent naar rato wanneer de inzet maar een deel van de week overlapt', () => {
    // Alleen maandag en dinsdag: 16 van de 40 roosteruren -> factor 0,4.
    const result = run(
      user({ allocations: [allocation({ start: MONDAY, end: TUESDAY, value: 100 })] }),
    );
    expect(result.allocationHours).toBe(16); // 40 x 100% x (16/40)
    expect(result.availabilityFactor).toBe(0.6);
  });

  it('telt status "gepland" mee wanneer de instelling dat zegt, anders niet', () => {
    const planned = user({ allocations: [allocation({ status: 'gepland' })] });
    const meegeteld = computeUserWeekAvailability(planned, WEEK, [], [], {
      includeRequestedAbsences: false,
      includePlannedAllocations: true,
    });
    const genegeerd = computeUserWeekAvailability(planned, WEEK, [], [], {
      includeRequestedAbsences: false,
      includePlannedAllocations: false,
    });
    expect(meegeteld.allocationHours).toBe(16);
    expect(genegeerd.allocationHours).toBe(0);
  });

  it('negeert afgeronde en geannuleerde inzet', () => {
    const result = run(
      user({
        allocations: [
          allocation({ status: 'afgerond' }),
          allocation({ status: 'geannuleerd' }),
        ],
      }),
    );
    expect(result.allocationHours).toBe(0);
  });

  it('negeert inzet die de showroomcapaciteit niet raakt', () => {
    const result = run(
      user({ allocations: [allocation({ reducesShowroomCapacity: false })] }),
    );
    expect(result.allocationHours).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Verlofstatus, ziekte zonder einddatum, feestdagen en sluitingen
// ---------------------------------------------------------------------------
describe('verlofstatus en bijzondere gevallen', () => {
  it('telt aangevraagd verlof alleen mee wanneer dat is ingesteld', () => {
    const requested = user({ absences: [leave(MONDAY, MONDAY, { status: 'aangevraagd' })] });
    expect(run(requested).leaveHours).toBe(0);
    const meegeteld = computeUserWeekAvailability(requested, WEEK, [], [], {
      includeRequestedAbsences: true,
      includePlannedAllocations: true,
    });
    expect(meegeteld.leaveHours).toBe(8);
  });

  it('negeert afgewezen en geannuleerd verlof', () => {
    const result = run(
      user({
        absences: [
          leave(MONDAY, MONDAY, { status: 'afgewezen' }),
          leave(TUESDAY, TUESDAY, { status: 'geannuleerd' }),
        ],
      }),
    );
    expect(result.leaveHours).toBe(0);
  });

  it('behandelt een ziekmelding zonder einddatum als doorlopend', () => {
    const sick = leave('2026-01-05', null as unknown as string, {
      typeName: 'Ziekte',
      status: 'goedgekeurd',
    });
    sick.end = null;
    const result = run(user({ absences: [sick] }));
    expect(result.leaveHours).toBe(40);
    expect(result.capacity).toBe(0);
  });

  it('respecteert een afwezigheidstype dat de capaciteit niet verlaagt', () => {
    const result = run(
      user({ absences: [leave(MONDAY, MONDAY, { reducesCapacity: false })] }),
    );
    expect(result.leaveHours).toBe(0);
  });

  it('telt een sluitingsperiode als volledig bezette week', () => {
    const result = run(user(), [], [{ start: MONDAY, end: SUNDAY, userId: null }]);
    expect(result.closureHours).toBe(40);
    expect(result.capacity).toBe(0);
    expect(isWeekClosed([result])).toBe(true);
  });

  it('past een sluiting voor een andere medewerker niet toe', () => {
    const result = run(user(), [], [{ start: MONDAY, end: SUNDAY, userId: 999 }]);
    expect(result.closureHours).toBe(0);
    expect(result.capacity).toBe(3);
  });

  it('telt een feestdag binnen een sluitingsperiode maar een keer', () => {
    const result = run(
      user(),
      [{ date: MONDAY, isDayOff: true, name: 'Testfeestdag' }],
      [{ start: MONDAY, end: SUNDAY, userId: null }],
    );
    expect(result.holidayHours + result.closureHours).toBe(40);
    expect(result.occupiedHours).toBe(40);
  });

  it('telt verlof op een feestdag niet dubbel', () => {
    const result = run(
      user({ absences: [leave(MONDAY, MONDAY)] }),
      [{ date: MONDAY, isDayOff: true, name: 'Testfeestdag' }],
    );
    expect(result.holidayHours).toBe(8);
    expect(result.leaveHours).toBe(0);
    expect(result.occupiedHours).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// capacityIfFullyStaffed — het verlies zichtbaar maken (7.4)
// ---------------------------------------------------------------------------
describe('capacityIfFullyStaffed', () => {
  it('negeert verlof en inzet, zodat het verschil het verlies toont', () => {
    const result = run(
      user({ absences: [leave(MONDAY, MONDAY)], allocations: [allocation()] }),
    );
    expect(result.capacityIfFullyStaffed).toBe(3);
    expect(result.capacity).toBe(1.8);
  });

  it('houdt wel rekening met feestdagen: een gesloten week levert niets op', () => {
    const result = run(user(), [], [{ start: MONDAY, end: SUNDAY, userId: null }]);
    expect(result.capacityIfFullyStaffed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Roosters in de tijd
// ---------------------------------------------------------------------------
describe('werkroosters in de tijd', () => {
  const schedules = [
    { validFrom: '2020-01-01', validTo: '2026-02-08', dayHours: FULLTIME, appointmentsPerWeek: 3 },
    { validFrom: '2026-02-09', validTo: null, dayHours: PARTTIME, appointmentsPerWeek: 2 },
  ];

  it('kiest het rooster dat geldig is op maandag van de week', () => {
    expect(scheduleOn(schedules, '2026-02-02')?.appointmentsPerWeek).toBe(3);
    expect(scheduleOn(schedules, '2026-02-09')?.appointmentsPerWeek).toBe(2);
  });

  it('rekent de hele week met het rooster van die maandag', () => {
    const result = run(user({ schedules }));
    expect(result.baseHours).toBe(32);
    expect(result.capacity).toBe(2);
  });

  it('levert nul capaciteit wanneer er geen geldig rooster is', () => {
    const result = run(
      user({
        schedules: [
          { validFrom: '2030-01-01', validTo: null, dayHours: FULLTIME, appointmentsPerWeek: 3 },
        ],
      }),
    );
    expect(result.baseHours).toBe(0);
    expect(result.availabilityFactor).toBe(0);
    expect(result.capacity).toBe(0);
  });
});
