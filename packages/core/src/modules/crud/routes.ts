/**
 * Generic CRUD factory (hoofdstuk 5).
 *
 * Written once and reused for every entity in the registry, so a new entity is
 * a registry entry rather than a new set of handlers.
 */
import type { FastifyInstance } from 'fastify';
import { ApiError, currentUser, requireRole } from '../../server.ts';
import { columnsFrom, compileFilter, compileSort, FilterError, type FilterNode } from '../query/filter.ts';
import { roleAtLeast } from '../auth/session.ts';
import { ENTITIES, ENTITY_BY_KEY, type EntityDefinition } from './registry.ts';
import type { DatabaseHandle } from '../../db/client.ts';
import { loadFields, optionResolver } from '../fields/repository.ts';
import { computeFormulaFields, validateCustomFields } from '../fields/validation.ts';
import { generatedColumnName } from '../fields/index-migration.ts';
import type { FieldDefinition } from '@showroom/shared';

type Row = Record<string, unknown>;

const MAX_PAGE_SIZE = 500;

function definitionFor(key: string): EntityDefinition {
  const definition = ENTITY_BY_KEY.get(key);
  if (!definition) {
    throw new ApiError(404, 'onbekende_entiteit', `Onbekende entiteit: "${key}".`);
  }
  return definition;
}

/**
 * Maps a filterable field to its column; unknown fields are rejected.
 *
 * Custom fields resolve to `json_extract(custom_fields, ...)`, except when the
 * field is indexed: dan wijst hij naar de gegenereerde kolom, zodat SQLite de
 * index ook echt kan gebruiken in plaats van elke rij open te maken.
 */
function resolverFor(definition: EntityDefinition, velden: readonly FieldDefinition[] = []) {
  const mapping = Object.fromEntries(definition.filterable.map((column) => [column, column]));
  for (const veld of velden) {
    if (veld.storage !== 'json' || veld.archivedAt) continue;
    mapping[veld.fieldKey] = veld.indexed
      ? generatedColumnName(veld.fieldKey)
      : `json_extract(custom_fields, '$.${veld.fieldKey}')`;
  }
  return columnsFrom(mapping);
}

/** De velddefinities van een entiteit, of een lege lijst als er geen maatwerk is. */
function veldenVoor(handle: DatabaseHandle, definition: EntityDefinition): FieldDefinition[] {
  return definition.customFields ? loadFields(handle, definition.key) : [];
}

/**
 * Vult de berekende formulevelden aan op een rij die naar buiten gaat.
 *
 * Formules worden niet opgeslagen maar bij het lezen uitgerekend, zodat ze
 * altijd kloppen met de rest van het record.
 */
function verrijk(velden: readonly FieldDefinition[], rij: Row): Row {
  const heeftFormule = velden.some((veld) => veld.type === 'formula' && !veld.archivedAt);
  const maatwerk =
    typeof rij.custom_fields === 'string'
      ? (JSON.parse(rij.custom_fields || '{}') as Record<string, unknown>)
      : ((rij.custom_fields as Record<string, unknown>) ?? {});

  if (!heeftFormule) return { ...rij, custom_fields: maatwerk };

  const { waarden, fouten } = computeFormulaFields(velden, { ...rij, ...maatwerk });
  return {
    ...rij,
    custom_fields: { ...maatwerk, ...waarden },
    ...(Object.keys(fouten).length > 0 ? { _formule_fouten: fouten } : {}),
  };
}

/**
 * Valideert de maatwerkvelden uit een verzoek en levert de JSON-tekst op die
 * in `custom_fields` gaat. Gooit een nette 400 met alle fouten tegelijk.
 */
function verwerkMaatwerk(
  handle: DatabaseHandle,
  definition: EntityDefinition,
  binnen: unknown,
  bestaand: Record<string, unknown>,
): string {
  const velden = veldenVoor(handle, definition);
  const invoer =
    binnen && typeof binnen === 'object' && !Array.isArray(binnen)
      ? (binnen as Record<string, unknown>)
      : {};

  const resultaat = validateCustomFields(velden, invoer, optionResolver(handle), bestaand);
  if (!resultaat.ok) {
    throw new ApiError(
      400,
      'validatiefout',
      resultaat.fouten.map((fout) => fout.melding).join(' '),
      resultaat.fouten,
    );
  }
  return JSON.stringify(resultaat.waarden);
}

/** De maatwerkvelden zoals ze nu in de database staan. */
function bestaandMaatwerk(rij: Row | null): Record<string, unknown> {
  if (!rij || typeof rij.custom_fields !== 'string') return {};
  try {
    return JSON.parse(rij.custom_fields || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function decodeFilter(raw: unknown): FilterNode | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(json) as FilterNode;
  } catch {
    throw new ApiError(400, 'ongeldig_filter', 'Het filter kon niet worden gelezen.');
  }
}

/** Splits a payload into known columns and rejects anything unexpected. */
function writableValues(definition: EntityDefinition, body: Row): { columns: string[]; values: unknown[] } {
  const columns: string[] = [];
  const values: unknown[] = [];
  const allowed = new Set(definition.writable);

  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key)) {
      throw new ApiError(400, 'onbekend_veld', `Het veld "${key}" bestaat niet of is niet bewerkbaar.`);
    }
    columns.push(key);
    // JSON columns arrive as objects; store them as text.
    values.push(
      value !== null && typeof value === 'object' ? JSON.stringify(value) : (value as unknown),
    );
  }
  return { columns, values };
}

function auditWrite(
  handle: DatabaseHandle,
  userId: number,
  entityKey: string,
  recordId: number,
  action: string,
  before: Row | null,
  after: Row | null,
): void {
  handle.raw
    .prepare(
      'INSERT INTO audit_log (user_id, entity_key, record_id, action, before, after) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      userId,
      entityKey,
      recordId,
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
    );
}

/**
 * The columns a table actually has, read once per table.
 *
 * Not every table carries the full audit set — `holidays` and `picklist_items`
 * deliberately do not — so the factory checks rather than assumes.
 */
const columnCache = new Map<string, Set<string>>();

function tableColumns(handle: DatabaseHandle, table: string): Set<string> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const rows = handle.raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const names = new Set(rows.map((row) => row.name));
  columnCache.set(table, names);
  return names;
}

type Weergave = {
  id: number;
  naam: string;
  kolommen: unknown;
  filters: unknown;
  sort: string | undefined;
  pageSize: number | undefined;
};

/** Haalt een opgeslagen weergave op, op id of op naam. */
function laadWeergave(
  handle: DatabaseHandle,
  entityKey: string,
  view: unknown,
): Weergave | null {
  const sleutel = String(view);
  const rij = handle.raw
    .prepare(
      `SELECT * FROM saved_views
        WHERE entity_key = ? AND archived_at IS NULL AND (id = ? OR name = ?)
        LIMIT 1`,
    )
    .get(entityKey, Number.isNaN(Number(sleutel)) ? -1 : Number(sleutel), sleutel) as Row | undefined;

  if (!rij) throw new ApiError(404, 'weergave_onbekend', `Onbekende weergave: "${sleutel}".`);

  const lees = <T>(waarde: unknown, fallback: T): T => {
    if (typeof waarde !== 'string' || waarde === '') return fallback;
    try {
      return JSON.parse(waarde) as T;
    } catch {
      return fallback;
    }
  };

  const sortering = lees<Array<{ field: string; direction?: string }>>(rij.sort, []);
  return {
    id: Number(rij.id),
    naam: String(rij.name),
    kolommen: lees<string[]>(rij.columns, []),
    filters: lees<unknown>(rij.filters, null),
    sort:
      sortering.length > 0
        ? sortering
            .map((entry) => (entry.direction === 'desc' ? `-${entry.field}` : entry.field))
            .join(',')
        : undefined,
    pageSize: rij.page_size ? Number(rij.page_size) : undefined,
  };
}

function readRow(handle: DatabaseHandle, definition: EntityDefinition, id: number): Row | null {
  return (
    (handle.raw.prepare(`SELECT * FROM ${definition.table} WHERE id = ?`).get(id) as Row) ?? null
  );
}

export async function registerCrudRoutes(app: FastifyInstance): Promise<void> {
  // Filter errors are the caller's mistake, not a server fault.
  const guard = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof FilterError) {
        throw new ApiError(400, 'ongeldig_filter', error.message);
      }
      throw error;
    }
  };

  app.get('/api/v1/entities', async () => ({
    data: ENTITIES.map((definition) => ({
      key: definition.key,
      writable: definition.writable,
      filterable: definition.filterable,
      writeRole: definition.writeRole,
    })),
  }));

  app.get('/api/v1/:entity/schema', async (request) => {
    const definition = definitionFor((request.params as { entity: string }).entity);
    const handle = request.core.handle;
    const fields = handle.raw
      .prepare('SELECT * FROM field_definitions WHERE entity_key = ? AND archived_at IS NULL ORDER BY sort_order')
      .all(definition.key) as Row[];
    const sections = handle.raw
      .prepare('SELECT * FROM layout_sections WHERE entity_key = ? AND archived_at IS NULL ORDER BY sort_order')
      .all(definition.key) as Row[];
    return { data: { entiteit: definition.key, velden: fields, secties: sections, kolommen: definition.writable } };
  });

  // --- lijst ---------------------------------------------------------------
  app.get('/api/v1/:entity', async (request) => {
    const definition = definitionFor((request.params as { entity: string }).entity);
    const query = { ...(request.query as Record<string, unknown>) };
    const handle = request.core.handle;
    const velden = veldenVoor(handle, definition);
    const columns = resolverFor(definition, velden);

    // Een opgeslagen weergave levert kolommen, filter en sortering aan; wat de
    // aanroeper zelf meegeeft wint, zodat je vanuit een weergave kunt bijsturen.
    const weergave = query.view ? laadWeergave(handle, definition.key, query.view) : null;
    if (weergave) {
      if (query.filter === undefined && weergave.filters) {
        query.filter = Buffer.from(JSON.stringify(weergave.filters)).toString('base64');
      }
      if (query.sort === undefined && weergave.sort) query.sort = weergave.sort;
      if (query.pageSize === undefined && weergave.pageSize) query.pageSize = weergave.pageSize;
    }

    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize ?? 50)));

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Soft-deleted rows are hidden unless explicitly asked for.
    if (definition.softDelete && query.includeArchived !== 'true') {
      conditions.push('archived_at IS NULL');
    }

    const filter = guard(() => compileFilter(decodeFilter(query.filter), columns));
    conditions.push(filter.sql);
    params.push(...filter.params);

    // Simple free-text search across the entity's searchable columns.
    const term = typeof query.q === 'string' ? query.q.trim() : '';
    if (term && definition.searchable?.length) {
      const parts = definition.searchable.map((column) => `${column} LIKE ?`);
      conditions.push(`(${parts.join(' OR ')})`);
      params.push(...definition.searchable.map(() => `%${term.replace(/[%_]/g, '')}%`));
    }

    const where = conditions.join(' AND ');
    const orderBy = guard(() => {
      if (typeof query.sort !== 'string' || query.sort.trim() === '') return definition.defaultSort;
      const sort = query.sort.split(',').map((entry) => {
        const descending = entry.startsWith('-');
        return { field: descending ? entry.slice(1) : entry, direction: descending ? ('desc' as const) : ('asc' as const) };
      });
      return compileSort(sort, columns, definition.defaultSort);
    });

    const total = Number(
      (
        handle.raw
          .prepare(`SELECT COUNT(*) AS n FROM ${definition.table} WHERE ${where}`)
          .get(...(params as never[])) as { n: number }
      ).n,
    );

    const rows = handle.raw
      .prepare(
        `SELECT * FROM ${definition.table} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      )
      .all(...([...params, pageSize, (page - 1) * pageSize] as never[])) as Row[];

    return {
      data: rows.map((rij) => verrijk(velden, rij)),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        ...(weergave ? { weergave: { id: weergave.id, naam: weergave.naam, kolommen: weergave.kolommen } } : {}),
      },
    };
  });

  // --- detail --------------------------------------------------------------
  app.get('/api/v1/:entity/:id', async (request) => {
    const definition = definitionFor((request.params as { entity: string }).entity);
    const id = Number((request.params as { id: string }).id);
    const handle = request.core.handle;
    const row = readRow(handle, definition, id);
    if (!row) throw new ApiError(404, 'niet_gevonden', 'Dit record bestaat niet.');
    return { data: verrijk(veldenVoor(handle, definition), row) };
  });

  // --- aanmaken ------------------------------------------------------------
  app.post('/api/v1/:entity', async (request, reply) => {
    const definition = definitionFor((request.params as { entity: string }).entity);
    const user = definition.writeRole && definition.writeRole !== 'user'
      ? requireRole(request, definition.writeRole as 'manager' | 'admin')
      : currentUser(request);

    const handle = request.core.handle;
    const body = { ...((request.body ?? {}) as Row) };

    // Maatwerkvelden gaan niet ongezien de JSON-kolom in: ze worden eerst
    // tegen het veldenregister gehouden.
    if (definition.customFields) {
      body.custom_fields = verwerkMaatwerk(handle, definition, body.custom_fields, {});
    }

    const { columns, values } = writableValues(definition, body);
    if (columns.length === 0) {
      throw new ApiError(400, 'leeg', 'Er zijn geen velden om op te slaan.');
    }
    const present = tableColumns(handle, definition.table);
    const allColumns = [...columns];
    const allValues = [...values];
    for (const column of ['created_by', 'updated_by']) {
      if (present.has(column) && !columns.includes(column)) {
        allColumns.push(column);
        allValues.push(user.id);
      }
    }

    const result = handle.raw
      .prepare(
        `INSERT INTO ${definition.table} (${allColumns.join(', ')})
         VALUES (${allColumns.map(() => '?').join(', ')})`,
      )
      .run(...(allValues as never[]));

    const id = Number(result.lastInsertRowid);
    let row = readRow(handle, definition, id);
    auditWrite(handle, user.id, definition.key, id, 'aangemaakt', null, row);

    definition.afterWrite?.({ handle, rij: row, id, actie: 'aangemaakt' });
    // De haak kan afgeleide waarden hebben bijgewerkt, dus opnieuw lezen.
    if (definition.afterWrite) row = readRow(handle, definition, id);

    return reply.code(201).send({ data: verrijk(veldenVoor(handle, definition), row!) });
  });

  // --- bijwerken -----------------------------------------------------------
  app.patch('/api/v1/:entity/:id', async (request) => {
    const definition = definitionFor((request.params as { entity: string }).entity);
    const user = definition.writeRole && definition.writeRole !== 'user'
      ? requireRole(request, definition.writeRole as 'manager' | 'admin')
      : currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const handle = request.core.handle;

    const before = readRow(handle, definition, id);
    if (!before) throw new ApiError(404, 'niet_gevonden', 'Dit record bestaat niet.');

    const body = { ...((request.body ?? {}) as Row) };

    // Bij een wijziging worden alleen de meegestuurde maatwerkvelden aangeraakt;
    // de rest van custom_fields blijft staan.
    if (definition.customFields && 'custom_fields' in body) {
      body.custom_fields = verwerkMaatwerk(
        handle,
        definition,
        body.custom_fields,
        bestaandMaatwerk(before),
      );
    }

    const { columns, values } = writableValues(definition, body);
    if (columns.length === 0) return { data: verrijk(veldenVoor(handle, definition), before) };

    const present = tableColumns(handle, definition.table);
    const assignments = columns.map((column) => `${column} = ?`);
    if (present.has('updated_at')) assignments.push("updated_at = datetime('now')");
    if (present.has('updated_by')) {
      assignments.push('updated_by = ?');
      values.push(user.id);
    }

    handle.raw
      .prepare(`UPDATE ${definition.table} SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...([...values, id] as never[]));

    let after = readRow(handle, definition, id);
    auditWrite(handle, user.id, definition.key, id, 'gewijzigd', before, after);

    definition.afterWrite?.({ handle, rij: after, id, actie: 'gewijzigd' });
    if (definition.afterWrite) after = readRow(handle, definition, id);

    return { data: verrijk(veldenVoor(handle, definition), after!) };
  });

  // --- verwijderen (soft delete) -------------------------------------------
  app.delete('/api/v1/:entity/:id', async (request) => {
    const definition = definitionFor((request.params as { entity: string }).entity);
    const user = definition.writeRole && definition.writeRole !== 'user'
      ? requireRole(request, definition.writeRole as 'manager' | 'admin')
      : currentUser(request);
    const id = Number((request.params as { id: string }).id);
    const handle = request.core.handle;

    const before = readRow(handle, definition, id);
    if (!before) throw new ApiError(404, 'niet_gevonden', 'Dit record bestaat niet.');

    if (!definition.softDelete) {
      handle.raw.prepare(`DELETE FROM ${definition.table} WHERE id = ?`).run(id);
      auditWrite(handle, user.id, definition.key, id, 'verwijderd', before, null);
      definition.afterWrite?.({ handle, rij: before, id, actie: 'verwijderd' });
      return { verwijderd: true, herstelbaar: false };
    }

    handle.raw
      .prepare(`UPDATE ${definition.table} SET archived_at = datetime('now') WHERE id = ?`)
      .run(id);
    auditWrite(handle, user.id, definition.key, id, 'gearchiveerd', before, null);
    // `before` en niet de huidige rij: de kans waar deze regel bij hoorde,
    // moet juist nu opnieuw worden doorgerekend.
    definition.afterWrite?.({ handle, rij: before, id, actie: 'verwijderd' });
    // Soft delete, zodat de "ongedaan maken"-toast uit hoofdstuk 9 kan werken.
    return { verwijderd: true, herstelbaar: true };
  });

  app.post('/api/v1/:entity/:id/restore', async (request) => {
    const definition = definitionFor((request.params as { entity: string }).entity);
    const user = currentUser(request);
    const id = Number((request.params as { id: string }).id);
    if (!definition.softDelete) {
      throw new ApiError(400, 'niet_herstelbaar', 'Dit soort record wordt definitief verwijderd.');
    }
    const handle = request.core.handle;
    const result = handle.raw
      .prepare(`UPDATE ${definition.table} SET archived_at = NULL WHERE id = ?`)
      .run(id);
    if (Number(result.changes ?? 0) === 0) {
      throw new ApiError(404, 'niet_gevonden', 'Dit record bestaat niet.');
    }
    const hersteld = readRow(handle, definition, id);
    auditWrite(handle, user.id, definition.key, id, 'hersteld', null, hersteld);
    definition.afterWrite?.({ handle, rij: hersteld, id, actie: 'hersteld' });
    return { data: readRow(handle, definition, id) };
  });

  // --- bulkacties -----------------------------------------------------------
  app.post('/api/v1/:entity/bulk', async (request) => {
    const definition = definitionFor((request.params as { entity: string }).entity);
    const user = currentUser(request);
    if (definition.writeRole && definition.writeRole !== 'user') {
      requireRole(request, definition.writeRole as 'manager' | 'admin');
    }

    const body = (request.body ?? {}) as { action?: string; ids?: number[]; payload?: Row };
    const ids = (body.ids ?? []).map((id) => Number(id)).filter((id) => Number.isInteger(id));
    if (ids.length === 0) throw new ApiError(400, 'leeg', 'Selecteer minimaal een record.');

    const handle = request.core.handle;
    const placeholders = ids.map(() => '?').join(', ');
    let changed = 0;

    switch (body.action) {
      case 'archive': {
        if (!definition.softDelete) {
          throw new ApiError(400, 'niet_ondersteund', 'Archiveren kan niet bij dit soort record.');
        }
        const result = handle.raw
          .prepare(
            `UPDATE ${definition.table} SET archived_at = datetime('now') WHERE id IN (${placeholders})`,
          )
          .run(...(ids as never[]));
        changed = Number(result.changes ?? 0);
        break;
      }
      case 'restore': {
        const result = handle.raw
          .prepare(`UPDATE ${definition.table} SET archived_at = NULL WHERE id IN (${placeholders})`)
          .run(...(ids as never[]));
        changed = Number(result.changes ?? 0);
        break;
      }
      case 'update': {
        const { columns, values } = writableValues(definition, body.payload ?? {});
        if (columns.length === 0) throw new ApiError(400, 'leeg', 'Geef aan wat er moet wijzigen.');
        const result = handle.raw
          .prepare(
            `UPDATE ${definition.table} SET ${columns.map((c) => `${c} = ?`).join(', ')}
              WHERE id IN (${placeholders})`,
          )
          .run(...([...values, ...ids] as never[]));
        changed = Number(result.changes ?? 0);
        break;
      }
      default:
        throw new ApiError(400, 'onbekende_actie', `Onbekende bulkactie: "${String(body.action)}".`);
    }

    for (const id of ids) {
      auditWrite(handle, user.id, definition.key, id, `bulk_${body.action}`, null, null);
      definition.afterWrite?.({
        handle,
        rij: readRow(handle, definition, id),
        id,
        actie: 'bulk',
      });
    }
    return { gewijzigd: changed };
  });

  // --- auditlog -------------------------------------------------------------
  app.get('/api/v1/audit', async (request) => {
    requireRole(request, 'admin');
    const query = request.query as Record<string, unknown>;
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 100)));
    const rows = request.core.handle.raw
      .prepare(
        `SELECT a.*, u.initials FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.id DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    return { data: rows };
  });

  // --- instellingen ---------------------------------------------------------
  app.get('/api/v1/settings', async (request) => {
    const rows = request.core.handle.raw.prepare('SELECT key, value FROM settings').all() as Row[];
    const data: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        data[String(row.key)] = JSON.parse(String(row.value));
      } catch {
        data[String(row.key)] = row.value;
      }
    }
    return { data };
  });

  app.patch('/api/v1/settings', async (request) => {
    const user = requireRole(request, 'admin');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const handle = request.core.handle;
    for (const [key, value] of Object.entries(body)) {
      handle.raw
        .prepare(
          `INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                          updated_at = datetime('now'),
                                          updated_by = excluded.updated_by`,
        )
        .run(key, JSON.stringify(value), user.id);
    }
    return { opgeslagen: Object.keys(body).length };
  });
}

/** Roles allowed to write, exported for the UI to grey out buttons. */
export function mayWrite(role: Parameters<typeof roleAtLeast>[0], definition: EntityDefinition): boolean {
  if (role === 'readonly') return false;
  return roleAtLeast(role, definition.writeRole ?? 'user');
}
