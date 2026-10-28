// services/pivotQueryBuilder.js
// Generic pivot query builder extracted from the original project's resolvers.
// It knows NOTHING about specific schemas, tables or columns: it receives the
// field definitions from metadataService and delegates engine-specific SQL
// fragments to the active dialect.

const { getDialect } = require('../dialects');

// ─── Filter condition builder ────────────────────────────────────────────────
// Builds a single SQL condition for one filter, advancing the param index.
// Returns null if the filter is invalid. Supported operators:
//   eq, neq, gt, lt, gte, lte, in, nin, like, nlike, sw, nsw, ew, new,
//   between, nbetween, isnull, notnull, regex

function buildFilterCondition(filter, paramIdx, fieldMap) {
  const fieldDef = fieldMap[filter.field];
  if (!fieldDef) return null;

  const sql = fieldDef.sql;
  const op = (filter.operator || 'eq').toLowerCase();
  const v = filter.value;
  const v2 = filter.value2;

  const hasV = v !== undefined && v !== null && v !== '';
  const hasV2 = v2 !== undefined && v2 !== null && v2 !== '';

  // Null-check operators (no params consumed)
  if (op === 'isnull') return { clause: `${sql} IS NULL`, value: null };
  if (op === 'notnull') return { clause: `${sql} IS NOT NULL`, value: null };

  const dialect = getDialect();

  // Between / Not between (two params)
  if (op === 'between' || op === 'nbetween') {
    if (!hasV || !hasV2) return null;
    const kw = op === 'between' ? 'BETWEEN' : 'NOT BETWEEN';
    return {
      clause: `${sql} ${kw} $${paramIdx} AND $${paramIdx + 1}`,
      value: [v, v2],
      paramCount: 2,
    };
  }

  if (!hasV) return null;

  switch (op) {
    case 'eq':  return { clause: `${sql} = $${paramIdx}`,  value: v };
    case 'neq': return { clause: `${sql} != $${paramIdx}`, value: v };
    case 'gt':  return { clause: `${sql} > $${paramIdx}`,  value: v };
    case 'lt':  return { clause: `${sql} < $${paramIdx}`,  value: v };
    case 'gte': return { clause: `${sql} >= $${paramIdx}`, value: v };
    case 'lte': return { clause: `${sql} <= $${paramIdx}`, value: v };
    case 'like':  return { clause: `${sql} ${dialect.likeOperator(false)} $${paramIdx}`,  value: `%${v}%` };
    case 'nlike': return { clause: `${sql} ${dialect.likeOperator(true)} $${paramIdx}`,   value: `%${v}%` };
    case 'sw':    return { clause: `${sql} ${dialect.likeOperator(false)} $${paramIdx}`,  value: `${v}%` };
    case 'nsw':   return { clause: `${sql} ${dialect.likeOperator(true)} $${paramIdx}`,   value: `${v}%` };
    case 'ew':    return { clause: `${sql} ${dialect.likeOperator(false)} $${paramIdx}`,  value: `%${v}` };
    case 'new':   return { clause: `${sql} ${dialect.likeOperator(true)} $${paramIdx}`,   value: `%${v}` };
    case 'in':    return { clause: `${sql} ${dialect.anyOperator(false, paramIdx)}`, value: toList(v) };
    case 'nin':   return { clause: `${sql} ${dialect.anyOperator(true, paramIdx)}`,  value: toList(v) };
    case 'regex': {
      const rx = dialect.regexOperator();
      if (!rx) return null; // dialect has no regex support
      return { clause: `${sql} ${rx} $${paramIdx}`, value: v };
    }
    default: return { clause: `${sql} = $${paramIdx}`, value: v };
  }
}

function toList(v) {
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

// ─── AND/OR grouping of filter conditions ────────────────────────────────────
// Consecutive conditions sharing the same `field` are grouped in parentheses
// and combined with the `combine` declared per condition.

function renderFilterGroups(filters, fieldMap, queryParams, paramIdx) {
  const groups = [];
  let current = null;

  for (const f of filters) {
    const condition = buildFilterCondition(f, paramIdx, fieldMap);
    if (!condition) continue;

    if (condition.value !== null) {
      if (condition.paramCount === 2) {
        queryParams.push(condition.value[0]);
        queryParams.push(condition.value[1]);
      } else {
        queryParams.push(condition.value);
      }
    }
    paramIdx += condition.paramCount || 1;

    if (current && current.field === f.field) {
      const conn = (f.combine || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND';
      current.parts.push({ conn, fragment: condition.clause });
    } else {
      if (current) groups.push(current);
      current = { field: f.field, parts: [{ conn: 'AND', fragment: condition.clause }] };
    }
  }
  if (current) groups.push(current);

  return {
    clauses: groups.map(g => {
      if (g.parts.length === 1) return g.parts[0].fragment;
      const inner = g.parts
        .map((p, i) => (i === 0 ? p.fragment : `${p.conn} ${p.fragment}`))
        .join(' ');
      return `(${inner})`;
    }),
    nextParamIndex: paramIdx,
  };
}

// ─── Full query builder ──────────────────────────────────────────────────────

/**
 * Builds the complete pivot SQL.
 * @param {object} opts
 * @param {object} opts.dataSource   - from metadataService.getDataSource()
 * @param {object} opts.fieldMap     - from metadataService.getFieldMap()
 * @param {Array}  opts.filters      - GraphQL FilterInput[]
 * @param {Array}  opts.groupBy      - field keys
 * @param {Array}  opts.values       - { field, aggregation }[]
 * @param {Array}  opts.fields       - raw detail mode field keys
 * @param {number} opts.limit
 * @param {boolean} opts.splitMultiValue
 * @param {number} opts.topN
 * @param {string} opts.whereClause   - mandatory permission clause ('' when none)
 * @param {number} opts.startParamIndex - first free $n placeholder index after
 *                                        the permission params (default 1)
 * @returns {object} { sql, params }
 */
function buildPivotQuery({
  dataSource,
  fieldMap,
  filters = [],
  groupBy = [],
  values = [],
  fields = [],
  limit = 5000,
  splitMultiValue = true,
  topN = null,
  whereClause = '',
  startParamIndex = 1,
}) {
  const dialect = getDialect();
  const alias = dataSource.alias || 't';

  let paramIdx = startParamIndex;
  const queryParams = [];

  // 1. Dynamic filters
  const { clauses: renderedClauses } = renderFilterGroups(filters, fieldMap, queryParams, paramIdx);

  let where = whereClause || '';
  if (renderedClauses.length > 0) {
    const filtersSQL = renderedClauses.join(' AND ');
    where = where ? `${where} AND ${filtersSQL}` : `WHERE ${filtersSQL}`;
  }

  // 2. SELECT / GROUP BY
  const selectParts = [];
  const columnNames = [];
  const lateralJoins = [];
  const groupByParts = [];

  if (groupBy.length > 0 || values.length > 0) {
    // Pivot (grouping/aggregation) mode
    for (const gf of groupBy) {
      const def = fieldMap[gf];
      if (!def) continue;
      const gAlias = gf.replace('.', '_');
      if (def.multiValue && splitMultiValue) {
        const lateral = dialect.splitMultiValueLateral(def.sql, `u_${gAlias}`);
        lateralJoins.push(lateral);
        const frag = dialect.splitMultiValueSelect(gAlias);
        selectParts.push(frag.select);
        groupByParts.push(frag.groupBy);
      } else {
        selectParts.push(`${def.sql} AS ${gAlias}`);
        groupByParts.push(def.sql);
      }
      columnNames.push(gf);
    }
    for (const vf of values) {
      const def = fieldMap[vf.field];
      if (!def) continue;
      const agg = (vf.aggregation || 'COUNT').toUpperCase();
      const vAlias = `${vf.field.replace('.', '_')}_${agg.toLowerCase()}`;
      if (agg === 'COUNT') {
        selectParts.push(`COUNT(${def.sql}) AS ${vAlias}`);
      } else {
        selectParts.push(`${agg}(${dialect.castNumeric(def.sql)}) AS ${vAlias}`);
      }
      columnNames.push(`${vf.field}(${agg})`);
    }
    if (groupBy.length === 0 && values.length === 0) {
      selectParts.push('COUNT(*) AS count');
      columnNames.push('count');
    }
  } else {
    // Raw detail mode (no grouping)
    for (const rf of fields) {
      const def = fieldMap[rf];
      if (!def) continue;
      const rAlias = rf.replace('.', '_');
      selectParts.push(`${def.sql} AS ${rAlias}`);
      columnNames.push(rf);
    }
  }

  if (selectParts.length === 0) {
    selectParts.push('COUNT(*) AS count');
    columnNames.push('count');
  }

  // 3. FROM / GROUP BY / ORDER BY / LIMIT
  const fromSQL = `${dataSource.sqlIdentifier} AS ${alias} ${lateralJoins.join(' ')}`;
  const groupBySQL = groupByParts.length ? 'GROUP BY ' + groupByParts.join(', ') : '';

  let orderBySQL = 'ORDER BY 1';
  let effectiveLimit = Math.min(limit, 10000);

  if (topN && Number(topN) > 0) {
    orderBySQL = (values.length > 0 && groupByParts.length > 0)
      ? `ORDER BY ${groupByParts.length + 1} DESC`
      : 'ORDER BY 1 DESC';
    effectiveLimit = Number(topN);
  }

  const sql = [
    `SELECT ${selectParts.join(', ')}`,
    `FROM ${fromSQL}`,
    where,
    groupBySQL,
    orderBySQL,
    `LIMIT ${effectiveLimit}`,
  ].filter(Boolean).join('\n');

  return { sql, params: queryParams, columns: columnNames };
}

module.exports = { buildFilterCondition, renderFilterGroups, buildPivotQuery };
