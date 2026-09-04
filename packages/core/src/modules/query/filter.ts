/**
 * Filter tree -> parameterised SQL (hoofdstuk 3.6).
 *
 * Every value leaves this module as a bound parameter and every identifier is
 * checked against a whitelist of columns the caller supplies. Nothing here ever
 * concatenates a user-supplied string into SQL.
 */

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startsWith'
  | 'in'
  | 'notIn'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'between'
  | 'dateWithin';

export type FilterCondition = {
  field: string;
  operator: FilterOperator;
  value?: unknown;
};

export type FilterGroup = {
  op: 'and' | 'or';
  children: FilterNode[];
};

export type FilterNode = FilterCondition | FilterGroup;

export type CompiledFilter = { sql: string; params: unknown[] };

export type ColumnResolver = {
  /**
   * Maps a field key to a SQL expression. Return `null` for unknown fields;
   * the compiler then rejects the filter rather than guessing.
   */
  resolve: (field: string) => string | null;
};

export class FilterError extends Error {}

function isGroup(node: FilterNode): node is FilterGroup {
  return (node as FilterGroup).children !== undefined;
}

/** Relative date windows for `dateWithin`, e.g. "deze_week" or "-30d". */
const RELATIVE_WINDOWS: Record<string, string> = {
  vandaag: "date('now')",
  deze_week: "date('now', 'weekday 1', '-7 days')",
  deze_maand: "date('now', 'start of month')",
  dit_jaar: "date('now', 'start of year')",
};

/**
 * Compiles a filter tree into a SQL fragment plus its bound parameters.
 * An empty tree compiles to `1 = 1`, so callers can always append it.
 */
export function compileFilter(node: FilterNode | null, columns: ColumnResolver): CompiledFilter {
  if (node === null) return { sql: '1 = 1', params: [] };

  const params: unknown[] = [];
  const sql = compileNode(node, columns, params, 0);
  return { sql, params };
}

function compileNode(
  node: FilterNode,
  columns: ColumnResolver,
  params: unknown[],
  depth: number,
): string {
  // A deeply nested tree is a sign of a generated or hostile payload.
  if (depth > 10) throw new FilterError('Het filter is te diep genest (maximaal 10 niveaus).');

  if (isGroup(node)) {
    if (node.op !== 'and' && node.op !== 'or') {
      throw new FilterError(`Onbekende filtercombinatie: "${String(node.op)}".`);
    }
    if (node.children.length === 0) return '1 = 1';
    const parts = node.children.map((child) => compileNode(child, columns, params, depth + 1));
    return `(${parts.join(node.op === 'and' ? ' AND ' : ' OR ')})`;
  }

  const column = columns.resolve(node.field);
  if (column === null) {
    throw new FilterError(`Onbekend veld in filter: "${node.field}".`);
  }

  switch (node.operator) {
    case 'eq':
      if (node.value === null) return `${column} IS NULL`;
      params.push(node.value);
      return `${column} = ?`;
    case 'neq':
      if (node.value === null) return `${column} IS NOT NULL`;
      params.push(node.value);
      return `(${column} IS NULL OR ${column} <> ?)`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const symbol = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[node.operator];
      params.push(node.value);
      return `${column} ${symbol} ?`;
    }
    case 'contains':
      params.push(`%${escapeLike(String(node.value ?? ''))}%`);
      return `${column} LIKE ? ESCAPE '\\'`;
    case 'startsWith':
      params.push(`${escapeLike(String(node.value ?? ''))}%`);
      return `${column} LIKE ? ESCAPE '\\'`;
    case 'in':
    case 'notIn': {
      const values = Array.isArray(node.value) ? node.value : [];
      // An empty IN list is not valid SQL; it also has an unambiguous meaning.
      if (values.length === 0) return node.operator === 'in' ? '1 = 0' : '1 = 1';
      params.push(...values);
      const holders = values.map(() => '?').join(', ');
      return node.operator === 'in'
        ? `${column} IN (${holders})`
        : `(${column} IS NULL OR ${column} NOT IN (${holders}))`;
    }
    case 'isEmpty':
      return `(${column} IS NULL OR ${column} = '')`;
    case 'isNotEmpty':
      return `(${column} IS NOT NULL AND ${column} <> '')`;
    case 'between': {
      const values = Array.isArray(node.value) ? node.value : [];
      if (values.length !== 2) {
        throw new FilterError(`"tussen" verwacht twee waarden voor veld "${node.field}".`);
      }
      params.push(values[0], values[1]);
      return `${column} BETWEEN ? AND ?`;
    }
    case 'dateWithin': {
      const window = String(node.value ?? '');
      const fixed = RELATIVE_WINDOWS[window];
      if (fixed) return `${column} >= ${fixed}`;
      // Relative offsets such as "-30d" or "+14d".
      const match = /^([+-]?\d{1,4})d$/.exec(window);
      if (!match) {
        throw new FilterError(`Onbekende periode: "${window}".`);
      }
      const days = Number(match[1]);
      // The modifier is built from a validated integer, never from raw input.
      return days < 0
        ? `${column} >= date('now', '${days} days')`
        : `${column} <= date('now', '+${days} days')`;
    }
    default:
      throw new FilterError(`Onbekende operator: "${String(node.operator)}".`);
  }
}

/** Escapes the LIKE wildcards so a literal % or _ cannot widen the match. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Builds a resolver from a plain field -> column mapping. */
export function columnsFrom(mapping: Record<string, string>): ColumnResolver {
  return {
    resolve: (field) => {
      const direct = mapping[field];
      if (direct) return direct;
      // Custom fields live in the JSON column and are addressed by key.
      if (/^cf_[a-z0-9_]{1,60}$/i.test(field)) {
        return `json_extract(custom_fields, '$.${field}')`;
      }
      return null;
    },
  };
}

/** Compiles an ORDER BY clause from a whitelist-checked sort list. */
export function compileSort(
  sort: Array<{ field: string; direction?: 'asc' | 'desc' }>,
  columns: ColumnResolver,
  fallback = 'id DESC',
): string {
  if (sort.length === 0) return fallback;
  const parts = sort.map((entry) => {
    const column = columns.resolve(entry.field);
    if (column === null) throw new FilterError(`Onbekend sorteerveld: "${entry.field}".`);
    return `${column} ${entry.direction === 'desc' ? 'DESC' : 'ASC'}`;
  });
  return parts.join(', ');
}
