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

/**
 * Colour coding held consistent across the whole app (hoofdstuk 9).
 *
 * These values were checked with a colourblindness validator rather than
 * chosen by eye. Two things follow from that check and are deliberate:
 *
 *  - Prognose is NOT a second, lighter blue. A lighter tint fell outside the
 *    usable lightness band and read as grey. Prognose is therefore the same
 *    blue with a hatched fill — which is also what "gestippeld" in 9 asks for.
 *  - "Capaciteit bij volledige bezetting" is the same green as the real
 *    capacity line, drawn dashed with the gap hatched, because it is the same
 *    measure and not a separate category.
 *
 * Verlof stays grey on purpose: absence is the absence of colour. Grey falls
 * below the chroma floor for a category, so a verlof block always carries a
 * texture and a text label as well, never colour alone.
 */
export const COLOR_TOKENS = {
  /** Showroombelasting, licht en donker. Prognose gebruikt dezelfde kleur. */
  load: { light: '#2563eb', dark: '#3b82f6' },
  /** Capaciteitslijn. De lijn "bij volledige bezetting" is dezelfde, gestreept. */
  capacity: { light: '#16a34a', dark: '#16a34a' },
  /** Verlof: bewust neutraal, altijd met patroon en label. */
  leave: { light: '#64748b', dark: '#64748b' },
  /** Ziekte. Het type is alleen zichtbaar voor management en de betrokkene. */
  sick: { light: '#dc2626', dark: '#ef4444' },
  /** Inzet elders. */
  allocation: { light: '#7c3aed', dark: '#8b5cf6' },
  /** Gesloten weken worden gearceerd, niet gekleurd. */
  closed: { light: '#e2e8f0', dark: '#1e293b' },
} as const;

/**
 * Stoplichtkleuren voor de weekstatus. Dit is een statuspalet, geen
 * categorieenpalet: oranje en rood liggen voor kleurenblinden dicht bij
 * elkaar, dus een stoplicht draagt altijd ook zijn tekstlabel (hoofdstuk 9).
 */
export const STATUS_TOKENS = {
  groen: { color: '#16a34a', label: 'Ruimte' },
  oranje: { color: '#ea580c', label: 'Vol' },
  rood: { color: '#dc2626', label: 'Overbezet' },
  gesloten: { color: '#64748b', label: 'Gesloten' },
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
