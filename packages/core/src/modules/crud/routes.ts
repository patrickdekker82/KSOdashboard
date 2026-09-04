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

type Row = Record<string, unknown>;

const MAX_PAGE_SIZE = 500;

function definitionFor(key: string): EntityDefinition {
  const definition = ENTITY_BY_KEY.get(key);
  if (!definition) {
    throw new ApiError(404, 'onbekende_entiteit', `Onbekende entiteit: "${key}".`);
  }
  return definition;
}

/** Maps a filterable field to its column; unknown fields are rejected. */
function resolverFor(definition: EntityDefinition) {
  const mapping = Object.fromEntries(definition.filterable.map((column) => [column, column]));
  return columnsFrom(definition.customFields ? mapping : mapping);
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
    const query = request.query as Record<string, unknown>;
    const handle = request.core.handle;
    const columns = resolverFor(definition);

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
      data: rows,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  });

  // --- detail --------------------------------------------------------------
  app.get('/api/v1/:entity/:id', async (request) => {
    const definition = definitionFor((request.params as { entity: string }).entity);
    const id = Number((request.params as { id: string }).id);
    const row = readRow(request.core.handle, definition, id);
    if (!row) throw new ApiError(404, 'niet_gevonden', 'Dit record bestaat niet.');
    return { data: row };
  });

  // --- aanmaken ------------------------------------------------------------
  app.post('/api/v1/:entity', async (request, reply) => {
    const definition = definitionFor((request.params as { entity: string }).entity);
    const user = definition.writeRole && definition.writeRole !== 'user'
      ? requireRole(request, definition.writeRole as 'manager' | 'admin')
      : currentUser(request);

    const { columns, values } = writableValues(definition, (request.body ?? {}) as Row);
    if (columns.length === 0) {
      throw new ApiError(400, 'leeg', 'Er zijn geen velden om op te slaan.');
    }

    const handle = request.core.handle;
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
    const row = readRow(handle, definition, id);
    auditWrite(handle, user.id, definition.key, id, 'aangemaakt', null, row);
    return reply.code(201).send({ data: row });
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

    const { columns, values } = writableValues(definition, (request.body ?? {}) as Row);
    if (columns.length === 0) return { data: before };

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

    const after = readRow(handle, definition, id);
    auditWrite(handle, user.id, definition.key, id, 'gewijzigd', before, after);
    return { data: after };
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
      return { verwijderd: true, herstelbaar: false };
    }

    handle.raw
      .prepare(`UPDATE ${definition.table} SET archived_at = datetime('now') WHERE id = ?`)
      .run(id);
    auditWrite(handle, user.id, definition.key, id, 'gearchiveerd', before, null);
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
    auditWrite(handle, user.id, definition.key, id, 'hersteld', null, readRow(handle, definition, id));
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
