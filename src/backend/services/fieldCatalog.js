// services/fieldCatalog.js
// Column auto-detection: reads the columns of a schema.table (or view /
// foreign table) from information_schema and maps PostgreSQL types to the
// component's field types (text | numeric | date). Used by the admin endpoints
// so the host app can enable/disable and label columns without touching code.

const TYPE_MAP = {
  // numeric
  int2: 'numeric', int4: 'numeric', int8: 'numeric',
  numeric: 'numeric', float4: 'numeric', float8: 'numeric', money: 'numeric',
  // date / time
  date: 'date', timestamp: 'date', timestamptz: 'date',
};

let pool = null;

function init({ pgPool }) {
  pool = pgPool;
}

function ensureInit() {
  if (!pool) {
    throw new Error('dash-pivot: fieldCatalog not initialized. Call createPivotBackend({ pool }) first.');
  }
}

/**
 * Lists every column of a schema.table (tables, views and foreign tables),
 * classified for the pivot engine, with a suggested human-friendly label.
 */
async function detectColumns({ schemaName, tableName }) {
  ensureInit();
  const { rows } = await pool.query(
    `SELECT c.column_name, c.udt_name
     FROM information_schema.columns c
     WHERE c.table_schema = $1 AND c.table_name = $2
     ORDER BY c.ordinal_position`,
    [schemaName, tableName]
  );
  return rows.map(r => ({
    columnName: r.column_name,
    sqlType: r.udt_name,
    suggestedType: TYPE_MAP[r.udt_name] || 'text',
    suggestedLabel: humanize(r.column_name),
  }));
}

/**
 * Verifies that every active field of a source still exists on the physical
 * table (columns may have been dropped/renamed since registration).
 * Returns the list of stale field keys.
 */
async function validateSourceColumns(source) {
  ensureInit();
  const { rows: dsRows } = await pool.query(
    `SELECT schema_name, table_name FROM pivot_datasources
     WHERE source_key = $1 AND is_active = TRUE LIMIT 1`,
    [source]
  );
  if (!dsRows.length) throw new Error(`Unknown data source: ${source}`);

  const { rows: cols } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    [dsRows[0].schema_name, dsRows[0].table_name]
  );
  const existing = new Set(rowsSafe({ rows }).map(r => r.column_name));

  const { rows: fields } = await pool.query(
    `SELECT field_key, column_name FROM pivot_fields WHERE datasource_id = $1`,
    [dsRows[0].id]
  );

  return fields
    .filter(f => !existing.has(f.column_name))
    .map(f => f.field_key);
}

function humanize(name) {
  return String(name)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function rowsSafe(res) {
  return res && res.rows ? res.rows : [];
}

module.exports = { init, detectColumns, validateSourceColumns };
