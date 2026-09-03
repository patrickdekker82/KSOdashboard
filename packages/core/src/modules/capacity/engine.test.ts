import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPACITY_SETTINGS,
  isoWeekRange,
  type CapacityInput,
  type CapacitySettings,
  type DayHours,
  type ProjectCapacityInput,
  type UserCapacityInput,
} from '@showroom/shared';
import { computeCapacity, findGaps, leadTimeKernel } from './engine.ts';

const FULLTIME: DayHours = [8, 8, 8, 8, 8, 0, 0];

/** 2026-W10 loopt van maandag 2 maart t/m zondag 8 maart 2026. */
const W = (week: number) => ({ year: 2026, week });

function guide(id: number, initials: string, appointmentsPerWeek = 3): UserCapacityInput {
  return {
    id,
    initials,
    schedules: [
      { validFrom: '2020-01-01', validTo: null, dayHours: FULLTIME, appointmentsPerWeek },
    ],
    absences: [],
    allocations: [],
  };
}

/** Bijlage B1: 24 woningen, showroomfase 2026-W10 t/m 2026-W17, V = 1, D = 5. */
function planVoorbeeld(overrides: Partial<ProjectCapacityInput> = {}): ProjectCapacityInput {
  return {
    id: 1,
    name: 'Plan Voorbeeld',
    units: 24,
    appointmentsPerUnit: 1,
    leadTimeWeeks: 5,
    phases: [
      { type: 'showroom', start: '2026-03-02', end: '2026-04-26', isLoad: true },
    ],
    assignments: [{ userId: 1, shareBp: 10_000 }],
    confidence: 'bevestigd',
    ...overrides,
  };
}

function input(overrides: Partial<CapacityInput> = {}): CapacityInput {
  return {
    from: W(10),
    to: W(30),
    projects: [planVoorbeeld()],
    users: [guide(1, 'DM'), guide(2, 'PD'), guide(3, 'RB')],
    holidays: [],
    closures: [],
    settings: { ...DEFAULT_CAPACITY_SETTINGS, totalWeeklyCapacity: null },
    ...overrides,
  };
}

const weekOf = (weeks: ReturnType<typeof computeCapacity>['weeks'], week: number) =>
  weeks.find((entry) => entry.isoYear === 2026 && entry.isoWeek === week)!;

const totalLoad = (weeks: ReturnType<typeof computeCapacity>['weeks']) =>
  weeks.reduce((sum, week) => sum + week.loadTotal, 0);

// ---------------------------------------------------------------------------
// Bijlage B1 — belasting en doorlooptijd-convolutie
// ---------------------------------------------------------------------------
describe('bijlage B1 — 24 woningen, 8 weken showroom, V=1, D=5', () => {
  it('verdeelt 24 afspraken en houdt het totaal exact op 24', () => {
    const { weeks } = computeCapacity(input());
    expect(totalLoad(weeks)).toBeCloseTo(24, 2);
  });

  it('loopt op vanaf W10 met 0,6 per week', () => {
    const { weeks } = computeCapacity(input());
    expect(weekOf(weeks, 10).loadTotal).toBeCloseTo(0.6, 2); // 3,0 x 0,2
    expect(weekOf(weeks, 11).loadTotal).toBeCloseTo(1.2, 2);
    expect(weekOf(weeks, 12).loadTotal).toBeCloseTo(1.8, 2);
    expect(weekOf(weeks, 13).loadTotal).toBeCloseTo(2.4, 2);
  });

  it('bereikt het plateau van 3,0 vanaf W14 en houdt dat t/m W17', () => {
    const { weeks } = computeCapacity(input());
    for (const week of [14, 15, 16, 17]) {
      expect(weekOf(weeks, week).loadTotal).toBeCloseTo(3, 2);
    }
  });

  it('loopt uit tot en met W21 en is daarna leeg', () => {
    const { weeks } = computeCapacity(input());
    expect(weekOf(weeks, 18).loadTotal).toBeCloseTo(2.4, 2);
    expect(weekOf(weeks, 19).loadTotal).toBeCloseTo(1.8, 2);
    expect(weekOf(weeks, 20).loadTotal).toBeCloseTo(1.2, 2);
    expect(weekOf(weeks, 21).loadTotal).toBeCloseTo(0.6, 2);
    expect(weekOf(weeks, 22).loadTotal).toBe(0);
  });

  it('respecteert de kernel: gewichten tellen altijd op tot 1', () => {
    for (const kernel of ['uniform', 'front-loaded', 'back-loaded'] as const) {
      const weights = leadTimeKernel(5, kernel);
      expect(weights).toHaveLength(5);
      expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
    }
    expect(leadTimeKernel(5, 'uniform')).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    const front = leadTimeKernel(5, 'front-loaded');
    expect(front[0]!).toBeGreaterThan(front[4]!);
  });

  it('houdt het totaal gelijk bij elke kernel', () => {
    for (const kernel of ['uniform', 'front-loaded', 'back-loaded'] as const) {
      const { weeks } = computeCapacity(
        input({ settings: { ...DEFAULT_CAPACITY_SETTINGS, totalWeeklyCapacity: null, kernel } }),
      );
      expect(totalLoad(weeks)).toBeCloseTo(24, 2);
    }
  });
});

// ---------------------------------------------------------------------------
// Bijlage B1 — sluitingsperiode midden in de doorlooptijd
// ---------------------------------------------------------------------------
describe('sluitingsperiode W15-W16', () => {
  // 2026-W15 = 6 t/m 12 april, 2026-W16 = 13 t/m 19 april.
  const closed = input({ closures: [{ start: '2026-04-06', end: '2026-04-19', userId: null }] });

  it('markeert W15 en W16 als gesloten met capaciteit 0', () => {
    const { weeks } = computeCapacity(closed);
    for (const week of [15, 16]) {
      expect(weekOf(weeks, week).isClosed).toBe(true);
      expect(weekOf(weeks, week).status).toBe('gesloten');
      expect(weekOf(weeks, week).capacity).toBe(0);
      expect(weekOf(weeks, week).loadTotal).toBe(0);
    }
  });

  it('laat het werk doorschuiven: het totaal blijft 24', () => {
    const { weeks } = computeCapacity(closed);
    expect(totalLoad(weeks)).toBeCloseTo(24, 2);
  });

  it('schuift het plateau twee weken op en laat de uitloop in W23 eindigen', () => {
    const { weeks } = computeCapacity(closed);
    expect(weekOf(weeks, 14).loadTotal).toBeCloseTo(3, 2);
    expect(weekOf(weeks, 17).loadTotal).toBeCloseTo(3, 2);
    expect(weekOf(weeks, 18).loadTotal).toBeCloseTo(3, 2);
    expect(weekOf(weeks, 19).loadTotal).toBeCloseTo(3, 2);
    expect(weekOf(weeks, 20).loadTotal).toBeCloseTo(2.4, 2);
    expect(weekOf(weeks, 23).loadTotal).toBeCloseTo(0.6, 2);
    expect(weekOf(weeks, 24).loadTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Jaarovergang met week 53
// ---------------------------------------------------------------------------
describe('jaarovergang', () => {
  it('levert 2026-W53 en loopt zonder gaten of dubbelingen door naar 2027', () => {
    // 2026 is een jaar met 53 ISO-weken.
    const weeks = isoWeekRange({ year: 2026, week: 50 }, { year: 2027, week: 3 });
    expect(weeks.map((week) => `${week.year}-W${week.week}`)).toEqual([
      '2026-W50',
      '2026-W51',
      '2026-W52',
      '2026-W53',
      '2027-W1',
      '2027-W2',
      '2027-W3',
    ]);
  });

  it('berekent capaciteit over de jaargrens zonder ontbrekende weken', () => {
    const { weeks } = computeCapacity(
      input({ from: { year: 2026, week: 50 }, to: { year: 2027, week: 3 }, projects: [] }),
    );
    expect(weeks).toHaveLength(7);
    const keys = weeks.map((week) => `${week.isoYear}-W${week.isoWeek}`);
    expect(new Set(keys).size).toBe(7);
    expect(keys).toContain('2026-W53');
  });
});

// ---------------------------------------------------------------------------
// Prognosebelasting
// ---------------------------------------------------------------------------
describe('prognoseprojecten', () => {
  const forecast = planVoorbeeld({ confidence: 'prognose', probabilityBp: 4000 });

  it('weegt met de kans wanneer forecastWeighting op probability staat', () => {
    const { weeks } = computeCapacity(input({ projects: [forecast] }));
    expect(totalLoad(weeks)).toBeCloseTo(24 * 0.4, 2);
    expect(weekOf(weeks, 14).loadForecast).toBeCloseTo(1.2, 2); // 3,0 x 0,4
    expect(weekOf(weeks, 14).loadConfirmed).toBe(0);
  });

  it('weegt niet wanneer forecastWeighting op none staat', () => {
    const { weeks } = computeCapacity(
      input({
        projects: [forecast],
        settings: {
          ...DEFAULT_CAPACITY_SETTINGS,
          totalWeeklyCapacity: null,
          forecastWeighting: 'none',
        },
      }),
    );
    expect(totalLoad(weeks)).toBeCloseTo(24, 2);
  });

  it('laat prognose helemaal weg wanneer includeForecast uitstaat', () => {
    const { weeks } = computeCapacity(
      input({
        projects: [forecast],
        settings: {
          ...DEFAULT_CAPACITY_SETTINGS,
          totalWeeklyCapacity: null,
          includeForecast: false,
        },
      }),
    );
    expect(totalLoad(weeks)).toBe(0);
  });

  it('scheidt bevestigde en prognosebelasting in aparte reeksen', () => {
    const { weeks } = computeCapacity(input({ projects: [planVoorbeeld(), forecast] }));
    const week = weekOf(weeks, 14);
    expect(week.loadConfirmed).toBeCloseTo(3, 2);
    expect(week.loadForecast).toBeCloseTo(1.2, 2);
    expect(week.loadTotal).toBeCloseTo(4.2, 2);
  });
});

// ---------------------------------------------------------------------------
// capacityMode
// ---------------------------------------------------------------------------
describe('capacityMode', () => {
  const settingsWith = (over: Partial<CapacitySettings>): CapacitySettings => ({
    ...DEFAULT_CAPACITY_SETTINGS,
    ...over,
  });

  it('som_medewerkers telt de individuele capaciteiten op', () => {
    const { weeks } = computeCapacity(
      input({ settings: settingsWith({ capacityMode: 'som_medewerkers', totalWeeklyCapacity: 5 }) }),
    );
    expect(weekOf(weeks, 14).capacity).toBe(9); // 3 x 3, plafond genegeerd
  });

  it('teamplafond schaalt het plafond met de gemiddelde beschikbaarheid', () => {
    const { weeks } = computeCapacity(
      input({ settings: settingsWith({ capacityMode: 'teamplafond', totalWeeklyCapacity: 5 }) }),
    );
    expect(weekOf(weeks, 14).capacity).toBe(5);
  });

  it('laagste_van_beide neemt het laagste van som en geschaald plafond', () => {
    const laag = computeCapacity(
      input({ settings: settingsWith({ capacityMode: 'laagste_van_beide', totalWeeklyCapacity: 5 }) }),
    );
    expect(weekOf(laag.weeks, 14).capacity).toBe(5); // plafond is beperkend

    const hoog = computeCapacity(
      input({ settings: settingsWith({ capacityMode: 'laagste_van_beide', totalWeeklyCapacity: 20 }) }),
    );
    expect(weekOf(hoog.weeks, 14).capacity).toBe(9); // de som is beperkend
  });

  it('schaalt het teamplafond mee wanneer iemand verlof heeft', () => {
    const users = [guide(1, 'DM'), guide(2, 'PD'), guide(3, 'RB')];
    users[2]!.absences = [
      {
        start: '2026-03-30',
        end: '2026-04-05',
        dayPart: 'hele_dag',
        reducesCapacity: true,
        status: 'goedgekeurd',
        typeName: 'Verlof',
      },
    ];
    const { weeks } = computeCapacity(
      input({ users, settings: settingsWith({ capacityMode: 'teamplafond', totalWeeklyCapacity: 9 }) }),
    );
    // 2026-W14 = 30 maart t/m 5 april: RB is de hele week weg.
    const week = weekOf(weeks, 14);
    expect(week.guidesAvailable).toBe(2);
    expect(week.capacity).toBeCloseTo(6, 2); // 9 x ((1 + 1 + 0) / 3)
  });
});

// ---------------------------------------------------------------------------
// Verdeling per begeleider
// ---------------------------------------------------------------------------
describe('verdeling per begeleider', () => {
  it('verdeelt de belasting volgens share_bp (DM/PD 50-50)', () => {
    const shared = planVoorbeeld({
      assignments: [
        { userId: 1, shareBp: 5_000 },
        { userId: 2, shareBp: 5_000 },
      ],
    });
    const { weeks } = computeCapacity(input({ projects: [shared] }));
    const week = weekOf(weeks, 14);
    expect(week.byUser.find((user) => user.initials === 'DM')?.load).toBeCloseTo(1.5, 2);
    expect(week.byUser.find((user) => user.initials === 'PD')?.load).toBeCloseTo(1.5, 2);
    expect(week.byUser.find((user) => user.initials === 'RB')?.load).toBe(0);
    expect(week.unassignedLoad).toBe(0);
  });

  it('zet belasting zonder toewijzing in de bak "niet toegewezen"', () => {
    const { weeks } = computeCapacity(input({ projects: [planVoorbeeld({ assignments: [] })] }));
    expect(weekOf(weeks, 14).unassignedLoad).toBeCloseTo(3, 2);
  });

  it('respecteert de looptijd van een toewijzing', () => {
    const project = planVoorbeeld({
      assignments: [{ userId: 1, shareBp: 10_000, start: '2026-04-01', end: null }],
    });
    const { weeks } = computeCapacity(input({ projects: [project] }));
    // 2026-W12 (16 t/m 22 maart) valt voor de toewijzing.
    expect(weekOf(weeks, 12).byUser.find((user) => user.initials === 'DM')?.load).toBe(0);
    expect(weekOf(weeks, 12).unassignedLoad).toBeGreaterThan(0);
    // 2026-W16 valt erbinnen.
    expect(weekOf(weeks, 16).byUser.find((user) => user.initials === 'DM')?.load).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Status, gelijktijdige trajecten en beschikbaarheid
// ---------------------------------------------------------------------------
describe('weekstatus en trajecten', () => {
  it('kleurt groen, oranje en rood volgens de drempels', () => {
    const { weeks } = computeCapacity(
      input({ settings: { ...DEFAULT_CAPACITY_SETTINGS, totalWeeklyCapacity: null } }),
    );
    expect(weekOf(weeks, 10).status).toBe('groen'); // 0,6 van 9
    const druk = computeCapacity(
      input({
        users: [guide(1, 'DM', 1)],
        settings: { ...DEFAULT_CAPACITY_SETTINGS, totalWeeklyCapacity: null },
      }),
    );
    expect(weekOf(druk.weeks, 14).capacity).toBe(1);
    expect(weekOf(druk.weeks, 14).status).toBe('rood'); // 3,0 van 1,0
  });

  it('telt gelijktijdige trajecten per week', () => {
    const tweede = planVoorbeeld({ id: 2, name: 'Plan Tweede' });
    const { weeks } = computeCapacity(input({ projects: [planVoorbeeld(), tweede] }));
    expect(weekOf(weeks, 14).concurrentProjects).toBe(2);
    expect(weekOf(weeks, 21).concurrentProjects).toBe(0); // alleen nog uitloop
  });

  it('toont het verlies aan capaciteit via capacityIfFullyStaffed', () => {
    const users = [guide(1, 'DM'), guide(2, 'PD'), guide(3, 'RB')];
    users[2]!.allocations = [
      {
        start: '2026-03-30',
        end: '2026-04-05',
        mode: 'percentage',
        value: 100,
        status: 'actief',
        reducesShowroomCapacity: true,
        title: 'Renovatie Kerkstraat',
      },
    ];
    const { weeks } = computeCapacity(
      input({ users, settings: { ...DEFAULT_CAPACITY_SETTINGS, capacityMode: 'som_medewerkers' } }),
    );
    const week = weekOf(weeks, 14);
    expect(week.capacity).toBeCloseTo(6, 2);
    expect(week.capacityIfFullyStaffed).toBeCloseTo(9, 2);
  });
});

// ---------------------------------------------------------------------------
// Gatdetectie (7.5)
// ---------------------------------------------------------------------------
describe('gatdetectie', () => {
  // Een gat vraagt om een reeel drukbeeld: met drie begeleiders (capaciteit 9)
  // komt een project van 24 woningen nooit boven 33% en is alles een gat. Met
  // een begeleider (capaciteit 3) zit het plateau op 100% en ontstaat er een
  // herkenbaar gat zodra de uitloop wegvalt.
  const gapInput = (over: Partial<CapacityInput> = {}): CapacityInput =>
    input({ users: [guide(1, 'DM', 3)], ...over });

  it('vindt een aaneengesloten gat met de juiste start, eind en acquisitiebehoefte', () => {
    const { weeks } = computeCapacity(gapInput());
    // Plateau W14-W17 op 3,0 van 3,0 = 100%; de uitloop zakt daarna weg.
    expect(weekOf(weeks, 14).utilisationPct).toBeCloseTo(100, 1);
    expect(weekOf(weeks, 19).utilisationPct).toBeCloseTo(60, 1);

    const gaps = findGaps(weeks, {
      thresholdPct: 50,
      minConsecutiveWeeks: 3,
      targetPct: 85,
      appointmentsPerUnit: 1,
    });

    expect(gaps).toHaveLength(1);
    const gap = gaps[0]!;
    expect(gap.startWeek).toEqual({ year: 2026, week: 20 }); // 1,2 van 3 = 40%
    expect(gap.endWeek).toEqual({ year: 2026, week: 30 });
    expect(gap.weeks).toBe(11);

    // Sigma max(0, 3 x 0,85 - belasting) over die elf weken.
    const belasting = [1.2, 0.6, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const verwacht = belasting.reduce((sum, load) => sum + Math.max(0, 3 * 0.85 - load), 0);
    expect(gap.shortfallAppointments).toBeCloseTo(verwacht, 1);
    expect(gap.shortfallUnits).toBe(Math.ceil(verwacht));
  });

  it('negeert gaten die korter zijn dan minConsecutiveWeeks', () => {
    const { weeks } = computeCapacity(gapInput({ to: { year: 2026, week: 22 } }));
    // W20 t/m W22 is maar drie weken.
    expect(findGaps(weeks, { minConsecutiveWeeks: 3 })).toHaveLength(1);
    expect(findGaps(weeks, { minConsecutiveWeeks: 6 })).toHaveLength(0);
  });

  it('rekent shortfallUnits om met V wanneer er twee afspraken per woning zijn', () => {
    const { weeks } = computeCapacity(gapInput());
    const eenAfspraak = findGaps(weeks, { appointmentsPerUnit: 1 })[0]!;
    const tweeAfspraken = findGaps(weeks, { appointmentsPerUnit: 2 })[0]!;
    expect(tweeAfspraken.shortfallUnits).toBe(Math.ceil(eenAfspraak.shortfallAppointments / 2));
  });

  it('breekt een gat niet op door een gesloten week (bouwvak W31-W33)', () => {
    const { weeks } = computeCapacity(
      gapInput({
        to: { year: 2026, week: 34 },
        closures: [{ start: '2026-07-27', end: '2026-08-16', userId: null }],
      }),
    );
    expect(weekOf(weeks, 31).isClosed).toBe(true);
    const gaps = findGaps(weeks, { minConsecutiveWeeks: 3 });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.startWeek).toEqual({ year: 2026, week: 20 });
    expect(gaps[0]!.endWeek).toEqual({ year: 2026, week: 34 });
    expect(gaps[0]!.weeks).toBe(12); // elf open weken + W34, de sluiting telt niet mee
  });
});
