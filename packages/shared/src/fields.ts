/**
 * Het veldenregister (hoofdstuk 3).
 *
 * Eén beschrijving per veld van elke entiteit, ook voor systeemvelden. Deze
 * typen worden zowel door de kern (validatie, opslag) als door de renderer
 * (formulier, lijst, filter) gebruikt, zodat er maar één waarheid is over wat
 * een veld is en wat erin mag.
 */

/** Alle veldtypes uit hoofdstuk 3.2. */
export const FIELD_TYPES = [
  'text',
  'textarea',
  'richtext',
  'number',
  'integer',
  'currency',
  'percent',
  'date',
  'datetime',
  'time',
  'boolean',
  'select',
  'multiselect',
  'relation',
  'user',
  'email',
  'phone',
  'url',
  'file',
  'color',
  'formula',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/**
 * Waar de waarde staat.
 *
 * `column` is een systeemveld met een eigen kolom: te verbergen en te
 * hernoemen, maar niet fysiek te verwijderen. `json` is een maatwerkveld in
 * `custom_fields`: wel echt te verwijderen, met data en al.
 */
export type FieldStorage = 'column' | 'json';

export type OptionsSource = 'static' | 'picklist' | 'entity';

export type FieldValidation = {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** Reguliere expressie als tekst; wordt met een tijdslimiet toegepast. */
  pattern?: string;
  patternMessage?: string;
  /** Vaste keuzes bij options_source = 'static'. */
  options?: Array<{ value: string; label: string; color?: string }>;
  /** Formule-expressie bij type 'formula'. */
  expression?: string;
  /** Toegestane extensies bij type 'file'. */
  extensions?: string[];
  maxSizeBytes?: number;
};

export type FieldDefinition = {
  id: number;
  entityKey: string;
  fieldKey: string;
  label: string;
  helpText?: string | null;
  type: FieldType;
  storage: FieldStorage;
  isSystem: boolean;
  /** Vergrendelde velden kunnen niet worden verborgen of hernoemd. */
  isLocked: boolean;
  required: boolean;
  uniqueValue: boolean;
  defaultValue?: string | null;
  optionsSource?: OptionsSource | null;
  picklistId?: number | null;
  relationEntity?: string | null;
  validation: FieldValidation;
  indexed: boolean;
  sectionId?: number | null;
  sortOrder: number;
  columnWidth?: number | null;
  visibleInList: boolean;
  visibleInDetail: boolean;
  editable: boolean;
  archivedAt?: string | null;
};

/** Eigenschappen die per veldtype vastliggen. */
export type FieldTypeInfo = {
  label: string;
  /** Hoe de waarde in JSON wordt bewaard. */
  storedAs: 'string' | 'number' | 'boolean' | 'array';
  /** Alleen-lezen types worden nooit uit een formulier opgeslagen. */
  readOnly: boolean;
  /** Standaardbreedte van de kolom in de lijst, in pixels. */
  defaultWidth: number;
  /** Uitlijning in de lijst. */
  align: 'left' | 'right' | 'center';
};

export const FIELD_TYPE_INFO: Record<FieldType, FieldTypeInfo> = {
  text: { label: 'Tekst', storedAs: 'string', readOnly: false, defaultWidth: 180, align: 'left' },
  textarea: { label: 'Tekstvak', storedAs: 'string', readOnly: false, defaultWidth: 240, align: 'left' },
  richtext: { label: 'Opgemaakte tekst', storedAs: 'string', readOnly: false, defaultWidth: 240, align: 'left' },
  number: { label: 'Getal', storedAs: 'number', readOnly: false, defaultWidth: 110, align: 'right' },
  integer: { label: 'Heel getal', storedAs: 'number', readOnly: false, defaultWidth: 100, align: 'right' },
  currency: { label: 'Bedrag', storedAs: 'number', readOnly: false, defaultWidth: 130, align: 'right' },
  percent: { label: 'Percentage', storedAs: 'number', readOnly: false, defaultWidth: 100, align: 'right' },
  date: { label: 'Datum', storedAs: 'string', readOnly: false, defaultWidth: 110, align: 'left' },
  datetime: { label: 'Datum en tijd', storedAs: 'string', readOnly: false, defaultWidth: 150, align: 'left' },
  time: { label: 'Tijd', storedAs: 'string', readOnly: false, defaultWidth: 90, align: 'left' },
  boolean: { label: 'Ja of nee', storedAs: 'boolean', readOnly: false, defaultWidth: 90, align: 'center' },
  select: { label: 'Keuzelijst', storedAs: 'string', readOnly: false, defaultWidth: 150, align: 'left' },
  multiselect: { label: 'Meerkeuze', storedAs: 'array', readOnly: false, defaultWidth: 200, align: 'left' },
  relation: { label: 'Verwijzing', storedAs: 'number', readOnly: false, defaultWidth: 180, align: 'left' },
  user: { label: 'Gebruiker', storedAs: 'number', readOnly: false, defaultWidth: 150, align: 'left' },
  email: { label: 'E-mailadres', storedAs: 'string', readOnly: false, defaultWidth: 200, align: 'left' },
  phone: { label: 'Telefoonnummer', storedAs: 'string', readOnly: false, defaultWidth: 140, align: 'left' },
  url: { label: 'Webadres', storedAs: 'string', readOnly: false, defaultWidth: 200, align: 'left' },
  file: { label: 'Bestand', storedAs: 'string', readOnly: false, defaultWidth: 180, align: 'left' },
  color: { label: 'Kleur', storedAs: 'string', readOnly: false, defaultWidth: 90, align: 'center' },
  // Een formule wordt berekend, nooit ingevoerd.
  formula: { label: 'Formule', storedAs: 'number', readOnly: true, defaultWidth: 130, align: 'right' },
};

/** Welke filteroperatoren zinnig zijn bij een type (hoofdstuk 3.6). */
export const OPERATORS_BY_TYPE: Record<FieldType, string[]> = {
  text: ['eq', 'neq', 'contains', 'startsWith', 'isEmpty', 'isNotEmpty', 'in'],
  textarea: ['contains', 'isEmpty', 'isNotEmpty'],
  richtext: ['contains', 'isEmpty', 'isNotEmpty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  integer: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  currency: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  percent: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'isEmpty', 'isNotEmpty'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'dateWithin', 'isEmpty', 'isNotEmpty'],
  datetime: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'dateWithin', 'isEmpty', 'isNotEmpty'],
  time: ['eq', 'gt', 'lt', 'between', 'isEmpty', 'isNotEmpty'],
  boolean: ['eq'],
  select: ['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
  multiselect: ['contains', 'isEmpty', 'isNotEmpty'],
  relation: ['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
  user: ['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
  email: ['eq', 'contains', 'startsWith', 'isEmpty', 'isNotEmpty'],
  phone: ['eq', 'contains', 'startsWith', 'isEmpty', 'isNotEmpty'],
  url: ['contains', 'isEmpty', 'isNotEmpty'],
  file: ['isEmpty', 'isNotEmpty'],
  color: ['eq', 'isEmpty', 'isNotEmpty'],
  formula: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'],
};

/**
 * Een maatwerkveldsleutel begint altijd met `cf_`.
 *
 * Dat is geen cosmetica: het houdt maatwerkvelden herkenbaar gescheiden van
 * kolomnamen, zodat een beheerder nooit per ongeluk een systeemkolom kan
 * overschaduwen, en het maakt de whitelist in de filtervertaler eenvoudig.
 */
export const CUSTOM_FIELD_PREFIX = 'cf_';
export const CUSTOM_FIELD_KEY_PATTERN = /^cf_[a-z][a-z0-9_]{0,59}$/;

export function isCustomFieldKey(key: string): boolean {
  return CUSTOM_FIELD_KEY_PATTERN.test(key);
}

/** Maakt van een label een geldige veldsleutel: "Bouwstroom 2" -> "cf_bouwstroom_2". */
export function toFieldKey(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    .slice(0, 55);
  const safe = /^[a-z]/.test(slug) ? slug : `veld_${slug}`;
  return `${CUSTOM_FIELD_PREFIX}${safe}`.slice(0, 62);
}
