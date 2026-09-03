/** System-wide defaults. Everything here is overridable in Instellingen. */
import type { CapacitySettings, GapOptions } from './types.ts';

export const APP_NAME = 'Showroom Suite';
export const APP_PROTOCOL = 'showroom';

/** Default capacity parameters — chapter 1 and bijlage A. */
export const DEFAULT_CAPACITY_SETTINGS: CapacitySettings = {
  totalWeeklyCapacity: 9, // A
  capacityMode: 'laagste_van_beide',
  maxConcurrentProjects: 3,
  thresholds: { green: 0.8, orange: 1.0 },
  includeForecast: true,
  forecastWeighting: 'probability',
  includePlannedAllocations: true,
  includeRequestedAbsences: false,
  minGuidesAvailable: 1,
  kernel: 'uniform',
};

/** V — physical showroom appointments per home. */
export const DEFAULT_APPOINTMENTS_PER_UNIT = 1;
/** D — weeks needed to complete an order. */
export const DEFAULT_LEAD_TIME_WEEKS = 5;

export const DEFAULT_GAP_OPTIONS: GapOptions = {
  thresholdPct: 50,
  minConsecutiveWeeks: 3,
  targetPct: 85,
};

/** Dutch VAT rates as basis points. */
export const VAT_RATES_BP = [2100, 900, 0] as const;
export const DEFAULT_VAT_RATE_BP = 2100;

/** Theme tokens for the colour coding held consistent across the app (hst. 9). */
export const COLOR_TOKENS = {
  loadConfirmed: '#2563eb', // showroombelasting blauw
  loadForecast: '#93c5fd', // prognose lichtblauw
  capacity: '#16a34a',
  capacityFullyStaffed: '#86efac',
  leave: '#9ca3af', // verlof grijs
  sick: '#dc2626', // ziekte rood
  allocation: '#7c3aed', // inzet elders paars
  closed: '#e5e7eb', // gesloten weken gearceerd
  green: '#16a34a',
  orange: '#ea580c',
  red: '#dc2626',
} as const;

export const ROLES = ['admin', 'manager', 'user', 'readonly'] as const;

/** Paths that must never hold the live database (hst. 2.3). */
export const BLOCKED_DB_PATH_PATTERNS = [
  'onedrive',
  'dropbox',
  'google drive',
  'googledrive',
  'icloud',
  'nextcloud',
  'sharepoint',
  'box sync',
  'pcloud',
  'mega',
  'sync.com',
  'tresorit',
] as const;
