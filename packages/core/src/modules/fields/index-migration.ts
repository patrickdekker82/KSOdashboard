/**
 * Indexen op maatwerkvelden (hoofdstuk 3.3).
 *
 * Een maatwerkveld staat als JSON in `custom_fields`. Filteren daarop kan
 * altijd, maar zonder index betekent dat een tabelscan. Zet een beheerder
 * `indexed` aan, dan genereert het systeem een virtuele gegenereerde kolom en
 * een index daarop:
 *
 *   ALTER TABLE opportunities ADD COLUMN cf_bouwstroom_idx TEXT
 *     GENERATED ALWAYS AS (json_extract(custom_fields, '$.cf_bouwstroom')) VIRTUAL;
 *   CREATE INDEX idx_opportunities_cf_bouwstroom ON opportunities(cf_bouwstroom_idx);
 *
 * VIRTUAL en niet STORED: de waarde wordt bij het lezen berekend, dus de
 * tabel wordt niet groter en bestaande rijen hoeven niet herschreven te worden.
 *
 * Dit is de enige plek in de applicatie waar DDL wordt samengesteld uit iets
 * dat een gebruiker heeft ingevoerd. Daarom staat er een harde controle op
 * zowel de tabelnaam als de veldsleutel: beide moeten letterlijk voorkomen in
 * een lijst die de code zelf kent.
 */
import { CUSTOM_FIELD_KEY_PATTERN, type FieldType } from '@showroom/shared';
import type { DatabaseHandle } from '../../db/client.ts';

export class IndexFout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexFout';
  }
}

/** SQLite-type waar een veldtype het beste op indexeert. */
export function sqliteTypeFor(type: FieldType): 'TEXT' | 'REAL' | 'INTEGER' {
  switch (type) {
    case 'number':
    case 'currency':
    case 'percent':
      return 'REAL';
    case 'integer':
    case 'relation':
    case 'user':
    case 'boolean':
      return 'INTEGER';
    default:
      return 'TEXT';
  }
}

export function generatedColumnName(fieldKey: string): string {
  return `${fieldKey}_idx`;
}

export function indexName(table: string, fieldKey: string): string {
  return `idx_${table}_${fieldKey}`;
}

/**
 * Controleert de bouwstenen voordat er ook maar één letter SQL ontstaat.
 * `toegestaneTabellen` komt uit het entiteitenregister, niet uit het verzoek.
 */
function controleer(table: string, fieldKey: string, toegestaneTabellen: readonly string[]): void {
  if (!toegestaneTabellen.includes(table)) {
    throw new IndexFout(`Onbekende tabel: "${table}".`);
  }
  if (!CUSTOM_FIELD_KEY_PATTERN.test(fieldKey)) {
    throw new IndexFout(
      `"${fieldKey}" is geen geldige maatwerkveldsleutel. ` +
        'Gebruik cf_ gevolgd door kleine letters, cijfers en liggende streepjes.',
    );
  }
}

export type IndexStatements = { kolom: string; index: string };

/** Stelt de twee statements samen die de index aanleggen. */
export function buildIndexStatements(
  table: string,
  fieldKey: string,
  type: FieldType,
  toegestaneTabellen: readonly string[],
): IndexStatements {
  controleer(table, fieldKey, toegestaneTabellen);
  const kolom = generatedColumnName(fieldKey);
  return {
    kolom:
      `ALTER TABLE ${table} ADD COLUMN ${kolom} ${sqliteTypeFor(type)} ` +
      `GENERATED ALWAYS AS (json_extract(custom_fields, '$.${fieldKey}')) VIRTUAL`,
    index: `CREATE INDEX IF NOT EXISTS ${indexName(table, fieldKey)} ON ${table}(${kolom})`,
  };
}

/** Stelt de statements samen die de index weer opruimen. */
export function buildDropStatements(
  table: string,
  fieldKey: string,
  toegestaneTabellen: readonly string[],
): IndexStatements {
  controleer(table, fieldKey, toegestaneTabellen);
  return {
    index: `DROP INDEX IF EXISTS ${indexName(table, fieldKey)}`,
    kolom: `ALTER TABLE ${table} DROP COLUMN ${generatedColumnName(fieldKey)}`,
  };
}

function kolomBestaat(handle: DatabaseHandle, table: string, kolom: string): boolean {
  // table_xinfo en niet table_info: die laatste laat gegenereerde kolommen weg,
  // waardoor we onze eigen indexkolom niet zouden terugvinden en bij een tweede
  // aanroep zouden struikelen over "duplicate column name".
  const rijen = handle.raw.prepare(`PRAGMA table_xinfo(${table})`).all() as Array<{ name: string }>;
  return rijen.some((rij) => rij.name === kolom);
}

/** Legt de index aan als hij er nog niet is. Idempotent. */
export function ensureIndex(
  handle: DatabaseHandle,
  table: string,
  fieldKey: string,
  type: FieldType,
  toegestaneTabellen: readonly string[],
): { aangelegd: boolean } {
  const statements = buildIndexStatements(table, fieldKey, type, toegestaneTabellen);
  const kolom = generatedColumnName(fieldKey);

  if (!kolomBestaat(handle, table, kolom)) {
    handle.raw.exec(statements.kolom);
  }
  handle.raw.exec(statements.index);
  return { aangelegd: true };
}

/** Haalt de index weer weg. Idempotent. */
export function dropIndex(
  handle: DatabaseHandle,
  table: string,
  fieldKey: string,
  toegestaneTabellen: readonly string[],
): { verwijderd: boolean } {
  const statements = buildDropStatements(table, fieldKey, toegestaneTabellen);
  handle.raw.exec(statements.index);
  if (kolomBestaat(handle, table, generatedColumnName(fieldKey))) {
    handle.raw.exec(statements.kolom);
  }
  return { verwijderd: true };
}

/**
 * Verwijdert een maatwerkveld definitief, inclusief de data in alle rijen.
 *
 * Dit is de knop met de dubbele bevestiging uit hoofdstuk 3.1. Er is geen weg
 * terug: `json_remove` haalt de sleutel uit elke rij.
 */
export function removeFieldData(
  handle: DatabaseHandle,
  table: string,
  fieldKey: string,
  toegestaneTabellen: readonly string[],
): { rijen: number } {
  controleer(table, fieldKey, toegestaneTabellen);

  // De index moet eerst weg: hij hangt aan een kolom die uit deze data leest.
  dropIndex(handle, table, fieldKey, toegestaneTabellen);

  const resultaat = handle.raw
    .prepare(
      `UPDATE ${table}
          SET custom_fields = json_remove(custom_fields, '$.' || ?)
        WHERE json_extract(custom_fields, '$.' || ?) IS NOT NULL`,
    )
    .run(fieldKey, fieldKey);

  return { rijen: Number(resultaat.changes ?? 0) };
}
