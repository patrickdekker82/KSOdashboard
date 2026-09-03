/** Domain types shared by the core (engines, API) and the renderer. */
import type { IsoDate, IsoWeek } from './iso-week.ts';
import type { BasisPoints, Cents } from './money.ts';

// ---------------------------------------------------------------------------
// Users, schedules, absence and allocation
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'manager' | 'user' | 'readonly';

/** Which part of a day an absence covers. Applies to the start and end day. */
export type DayPart = 'hele_dag' | 'ochtend' | 'middag';

export type AbsenceStatus = 'aangevraagd' | 'goedgekeurd' | 'afgewezen' | 'geannuleerd';

export type AllocationStatus = 'gepland' | 'actief' | 'afgerond' | 'geannuleerd';

/** How the size of a temporary allocation elsewhere is expressed. */
export type AllocationMode = 'percentage' | 'dagen_per_week' | 'uren_per_week';

/** Hours worked per weekday, Monday first: [ma, di, wo, do, vr, za, zo]. */
export type DayHours = readonly [number, number, number, number, number, number, number];

export type WorkScheduleInput = {
  validFrom: IsoDate;
  /** `null` means open-ended. */
  validTo: IsoDate | null;
  dayHours: DayHours;
  /** Showroom appointments this person handles in a full week. */
  appointmentsPerWeek: number;
};

export type AbsenceInput = {
  start: IsoDate;
  /** `null` = open-ended, e.g. a sick note without a return date. */
  end: IsoDate | null;
  dayPart: DayPart;
  /** Overrides `dayPart`; capped at the scheduled hours for that day. */
  hoursOverride?: number | null;
  reducesCapacity: boolean;
  status: AbsenceStatus;
  /** Absence type name, for the per-user breakdown in the output. */
  typeName?: string;
};

export type AllocationInput = {
  start: IsoDate;
  end: IsoDate;
  mode: AllocationMode;
  value: number;
  status: AllocationStatus;
  reducesShowroomCapacity: boolean;
  title?: string;
};

export type UserCapacityInput = {
  id: number;
  initials: string;
  schedules: WorkScheduleInput[];
  absences: AbsenceInput[];
  allocations: AllocationInput[];
};

export type HolidayInput = { date: IsoDate; isDayOff: boolean; name?: string };

/** A closure period; `userId === null` means it applies to everyone. */
export type ClosureInput = { start: IsoDate; end: IsoDate; userId: number | null };

// ---------------------------------------------------------------------------
// Availability output (chapter 7.2)
// ---------------------------------------------------------------------------

export type AvailabilityBreakdownItem = { type: string; hours: number };

export type UserWeekAvailability = {
  userId: number;
  initials: string;
  isoWeek: IsoWeek;
  /** Scheduled hours for the week, before anything is deducted. */
  baseHours: number;
  /** Days in the week with scheduled hours > 0 (display only). */
  baseDays: number;
  holidayHours: number;
  closureHours: number;
  leaveHours: number;
  allocationHours: number;
  /** After the double-counting correction of 7.2 step 6. */
  occupiedHours: number;
  availableHours: number;
  /** availableHours / baseHours, 0 when the person does not work that week. */
  availabilityFactor: number;
  /** appointmentsPerWeek x availabilityFactor. */
  capacity: number;
  /** Capacity without any absence or allocation — shows what is being lost. */
  capacityIfFullyStaffed: number;
  absences: AvailabilityBreakdownItem[];
  allocations: AvailabilityBreakdownItem[];
};

// ---------------------------------------------------------------------------
// Capacity input and output (chapter 7.1, 7.4)
// ---------------------------------------------------------------------------

export type CapacityMode = 'som_medewerkers' | 'teamplafond' | 'laagste_van_beide';
export type ForecastWeighting = 'none' | 'probability';
export type LoadKernel = 'uniform' | 'front-loaded' | 'back-loaded';
export type WeekStatus = 'groen' | 'oranje' | 'rood' | 'gesloten';
export type ProjectConfidence = 'bevestigd' | 'prognose';

export type ProjectPhaseInput = {
  type: string;
  start: IsoDate;
  end: IsoDate;
  /** Only phases with `isLoad` produce showroom workload. */
  isLoad: boolean;
  unitsOverride?: number | null;
};

export type ProjectAssignmentInput = {
  userId: number;
  shareBp: BasisPoints;
  start?: IsoDate | null;
  end?: IsoDate | null;
};

export type ProjectCapacityInput = {
  id: number;
  name: string;
  units: number;
  /** V — physical showroom appointments per home. */
  appointmentsPerUnit: number;
  /** D — weeks of follow-up work per appointment block. */
  leadTimeWeeks: number;
  phases: ProjectPhaseInput[];
  assignments: ProjectAssignmentInput[];
  confidence: ProjectConfidence;
  probabilityBp?: BasisPoints | null;
};

export type CapacitySettings = {
  /** A — team ceiling in appointments per week; `null` disables the ceiling. */
  totalWeeklyCapacity: number | null;
  capacityMode: CapacityMode;
  maxConcurrentProjects: number;
  /** Utilisation fractions, not percentages: { green: 0.8, orange: 1.0 }. */
  thresholds: { green: number; orange: number };
  includeForecast: boolean;
  forecastWeighting: ForecastWeighting;
  /** Whether allocations with status 'gepland' already reduce capacity. */
  includePlannedAllocations: boolean;
  /** Whether absences with status 'aangevraagd' already reduce capacity. */
  includeRequestedAbsences: boolean;
  minGuidesAvailable: number;
  kernel: LoadKernel;
};

export type CapacityInput = {
  from: IsoWeek;
  to: IsoWeek;
  projects: ProjectCapacityInput[];
  users: UserCapacityInput[];
  holidays: HolidayInput[];
  closures: ClosureInput[];
  settings: CapacitySettings;
};

export type CapacityWeekUser = {
  userId: number;
  initials: string;
  baseHours: number;
  holidayHours: number;
  closureHours: number;
  leaveHours: number;
  allocationHours: number;
  availableHours: number;
  availabilityPct: number;
  capacity: number;
  load: number;
  utilisationPct: number;
  absences: AvailabilityBreakdownItem[];
  allocations: AvailabilityBreakdownItem[];
};

export type CapacityWeekProject = {
  id: number;
  name: string;
  load: number;
  phaseType: string;
};

export type CapacityWeek = {
  isoYear: number;
  isoWeek: number;
  startDate: IsoDate;
  endDate: IsoDate;
  isClosed: boolean;
  loadConfirmed: number;
  loadForecast: number;
  loadTotal: number;
  capacity: number;
  /** Capacity if nobody were absent or allocated elsewhere. */
  capacityIfFullyStaffed: number;
  utilisationPct: number;
  status: WeekStatus;
  concurrentProjects: number;
  /** Number of guides with an availability factor > 0. */
  guidesAvailable: number;
  /** Load that no assignment claimed. */
  unassignedLoad: number;
  byUser: CapacityWeekUser[];
  projects: CapacityWeekProject[];
};

// ---------------------------------------------------------------------------
// Gap detection (chapter 7.5)
// ---------------------------------------------------------------------------

export type GapOptions = {
  thresholdPct: number;
  minConsecutiveWeeks: number;
  targetPct: number;
};

export type CapacityGap = {
  startWeek: IsoWeek;
  endWeek: IsoWeek;
  weeks: number;
  avgUtilisationPct: number;
  avgCapacity: number;
  /** Appointments short of the target utilisation across the whole gap. */
  shortfallAppointments: number;
  /** The number the acquisition meeting cares about: homes still needed. */
  shortfallUnits: number;
};

// ---------------------------------------------------------------------------
// Packages and pricing (chapter 6.5)
// ---------------------------------------------------------------------------

export type PricingMode = 'sum' | 'fixed' | 'sum_with_margin';
export type VatMode = 'incl' | 'excl';

export type PackageItemInput = {
  id?: number;
  description: string;
  quantity: number;
  unitPriceCents: Cents;
  discountBp: BasisPoints;
  vatRateBp: BasisPoints;
  costPriceCents?: Cents;
  isOptional: boolean;
  /** Whether the customer selected this optional line. Required lines ignore it. */
  isSelected?: boolean;
};

export type PackagePricingInput = {
  pricingMode: PricingMode;
  fixedPriceCents?: Cents | null;
  marginBp?: BasisPoints | null;
  vatMode: VatMode;
  items: PackageItemInput[];
};

export type PricedLine = {
  description: string;
  quantity: number;
  unitPriceCents: Cents;
  discountBp: BasisPoints;
  amountCents: Cents;
  vatRateBp: BasisPoints;
  vatCents: Cents;
  isOptional: boolean;
  isSelected: boolean;
};

export type PackagePrice = {
  lines: PricedLine[];
  subtotalCents: Cents;
  discountCents: Cents;
  vatCents: Cents;
  totalExclVatCents: Cents;
  totalInclVatCents: Cents;
  costCents: Cents;
  marginCents: Cents;
  marginBp: BasisPoints;
  /** Set when `fixed` pricing was used and the fixed price differs from the sum. */
  fixedAdjustmentCents: Cents;
};
