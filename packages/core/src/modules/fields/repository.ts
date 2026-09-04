/** Lezen en schrijven van velddefinities en layout-secties. */
import type { FieldDefinition, FieldType, FieldValidation } from '@showroom/shared';
import type { DatabaseHandle } from '../../db/client.ts';

type Row = Record<string, unknown>;

const bool = (waarde: unknown): boolean => Number(waarde) === 1;

function parseJson<T>(waarde: unknown, fallback: T): T {
  if (typeof waarde !== 'string' || waarde === '') return fallback;
  try {
    return JSON.parse(waarde) as T;
  } catch {
    return fallback;
  }
}

export function rowToField(row: Row): FieldDefinition {
  return {
    id: Number(row.id),
    entityKey: String(row.entity_key),
    fieldKey: String(row.field_key),
    label: String(row.label),
    helpText: (row.help_text as string | null) ?? null,
    type: String(row.type) as FieldType,
    storage: row.storage === 'column' ? 'column' : 'json',
    isSystem: bool(row.is_system),
    isLocked: bool(row.is_locked),
    required: bool(row.required),
    uniqueValue: bool(row.unique_value),
    defaultValue: (row.default_value as string | null) ?? null,
    optionsSource: (row.options_source as FieldDefinition['optionsSource']) ?? null,
    picklistId: row.picklist_id === null ? null : Number(row.picklist_id),
    relationEntity: (row.relation_entity as string | null) ?? null,
    validation: parseJson<FieldValidation>(row.validation, {}),
    indexed: bool(row.indexed),
    sectionId: row.section_id === null ? null : Number(row.section_id),
    sortOrder: Number(row.sort_order),
    columnWidth: row.column_width === null ? null : Number(row.column_width),
    visibleInList: bool(row.visible_in_list),
    visibleInDetail: bool(row.visible_in_detail),
    editable: bool(row.editable),
    archivedAt: (row.archived_at as string | null) ?? null,
  };
}

/** Alle actieve velddefinities van een entiteit, op volgorde. */
export function loadFields(
  handle: DatabaseHandle,
  entityKey: string,
  opties: { includeArchived?: boolean } = {},
): FieldDefinition[] {
  const where = opties.includeArchived ? '' : 'AND archived_at IS NULL';
  const rijen = handle.raw
    .prepare(
      `SELECT * FROM field_definitions
        WHERE entity_key = ? ${where}
        ORDER BY sort_order, id`,
    )
    .all(entityKey) as Row[];
  return rijen.map(rowToField);
}

export function loadField(handle: DatabaseHandle, id: number): FieldDefinition | null {
  const rij = handle.raw.prepare('SELECT * FROM field_definitions WHERE id = ?').get(id) as
    | Row
    | undefined;
  return rij ? rowToField(rij) : null;
}

/**
 * De toegestane keuzes van een select of multiselect.
 *
 * `static` haalt ze uit de validatieregels van het veld zelf, `picklist` uit
 * de keuzelijst. `entity` levert `null`: dan is de verwijzing zelf leidend en
 * controleert de database het via de foreign key.
 */
export function optionsFor(handle: DatabaseHandle, definition: FieldDefinition): string[] | null {
  if (definition.optionsSource === 'static') {
    return (definition.validation.options ?? []).map((optie) => optie.value);
  }
  if (definition.optionsSource === 'picklist' && definition.picklistId) {
    const rijen = handle.raw
      .prepare('SELECT value FROM picklist_items WHERE picklist_id = ? AND archived_at IS NULL')
      .all(definition.picklistId) as Array<{ value: string }>;
    return rijen.map((rij) => rij.value);
  }
  return null;
}

/** Bouwt de optiebron die de validatie gebruikt, met caching per veld. */
export function optionResolver(handle: DatabaseHandle) {
  const cache = new Map<number, string[] | null>();
  return (definition: FieldDefinition): string[] | null => {
    if (!cache.has(definition.id)) cache.set(definition.id, optionsFor(handle, definition));
    return cache.get(definition.id) ?? null;
  };
}

export type LayoutSection = {
  id: number;
  entityKey: string;
  name: string;
  sortOrder: number;
  columns: number;
  collapsible: boolean;
  defaultOpen: boolean;
};

export function loadSections(handle: DatabaseHandle, entityKey: string): LayoutSection[] {
  const rijen = handle.raw
    .prepare(
      `SELECT * FROM layout_sections
        WHERE entity_key = ? AND archived_at IS NULL
        ORDER BY sort_order, id`,
    )
    .all(entityKey) as Row[];
  return rijen.map((row) => ({
    id: Number(row.id),
    entityKey: String(row.entity_key),
    name: String(row.name),
    sortOrder: Number(row.sort_order),
    columns: Number(row.columns),
    collapsible: bool(row.collapsible),
    defaultOpen: bool(row.default_open),
  }));
}
