// services/metadataService.js
// Reads data-source and field definitions from the metadata tables installed
// by the package migration (pivot_datasources / pivot_fields).
//
// This REPLACES the hardcoded FIELD_MAP / DATA_SOURCES of the original
// project: every host application registers its own schemas, tables, views
// and columns — either through the admin API or by inserting rows directly.

const { getDialect } = require('../dialects');
const { getCache } = require('./cacheService');

const SOURCES_TTL = 60;   // short TTL so newly registered sources appear fast
const FIELDS_TTL = 3600;  // 1 hour — field catalog is mostly static

let pool = null;
let cache = null;

function init({ pgPool }) {
  pool = pgPool;
  cache = getCache();
}

function ensureInit() {
  if (!pool) {
    throw new Error('dash-pivot: metadataService not initialized. Call createPivotBackend({ pool }) first.');
  }
}

function invalidateSource(source) {
  cache.del(`pivot:datasource:${source}`);
  cache.del(`pivot:fieldMap:${source}`);
}

/**
 * Returns the active data source definition for a `source` key, or null.
 * Shape:
 * {
 *   id, sourceKey, displayName, schemaName, tableName, tableType,
 *   sqlIdentifier: '"schema"."table"',
 * }
 */
async function getDataSource(source) {
  ensureInit();
  const cacheKey = `pivot:datasource:${source}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const { rows } = await pool.query(
    `SELECT id, source_key, display_name, schema_name, table_name, table_type
     FROM pivot_datasources
     WHERE source_key = $1 AND is_active = TRUE
     LIMIT 1`,
    [source]
  );
  if (!rows.length) return null;

  const ds = {
    id: rows[0].id,
    sourceKey: rows[0].source_key,
    displayName: rows[0].display_name,
    schemaName: rows[0].schema_name,
    tableName: rows[0].table_name,
    tableType: rows[0].table_type,
    sqlIdentifier: null, // built lazily below via dialect
  };
  const dialect = getDialect();
  ds.sqlIdentifier = `${dialect.quoteIdent(ds.schemaName)}.${dialect.quoteIdent(ds.tableName)}`;
  ds.alias = 't';

  await cache.set(cacheKey, ds, SOURCES_TTL);
  return ds;
}

/**
 * Returns the enabled fields of a data source, keyed by field key.
 * Shape per field: { key, column, sql, label, category, numeric, date, multiValue }
 * `sql` is the fully qualified, quoted expression (e.g. `t."estado"`).
 */
async function getFieldMap(source) {
  ensureInit();
  const cacheKey = `pivot:fieldMap:${source}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const ds = await getDataSource(source);
  if (!ds) return {};

  const dialect = getDialect();

  const { rows } = await pool.query(
    `SELECT field_key, column_name, display_label, category, field_type, is_multivalue
     FROM pivot_fields
     WHERE datasource_id = $1 AND is_active = TRUE
     ORDER BY category, field_key`,
    [ds.id]
  );

  const fieldMap = {};
  for (const row of rows) {
    fieldMap[row.field_key] = {
      key: row.field_key,
      column: row.column_name,
      sql: `${ds.alias}.${dialect.quoteIdent(row.column_name)}`,
      label: row.display_label,
      category: row.category || 'General',
      numeric: row.field_type === 'numeric',
      date: row.field_type === 'date',
      multiValue: !!row.is_multivalue,
    };
  }

  await cache.set(cacheKey, fieldMap, FIELDS_TTL);
  return fieldMap;
}

/** Invalidates cached metadata after admin CRUD operations. */
async function invalidate(source) {
  if (source) {
    await cache.del(`pivot:datasource:${source}`);
    await cache.del(`pivot:fieldMap:${source}`);
  } else {
    await cache.delByPrefix('pivot:datasource:');
    await cache.delByPrefix('pivot:fieldMap:');
  }
}

module.exports = { init, getDataSource, getFieldMap, invalidate, getPool: () => pool };
