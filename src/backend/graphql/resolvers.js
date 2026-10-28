// graphql/resolvers.js
// Generic resolvers. They know nothing about specific schemas, tables or
// domains: data sources and fields come from the metadata tables via
// metadataService, and row-level security is delegated to the permission hook
// injected by the host application (setPermissionHook).

const crypto = require('crypto');
const { getCache } = require('../services/cacheService');
const metadataService = require('../services/metadataService');
const { buildPivotQuery } = require('../services/pivotQueryBuilder');

const DATA_TTL = 60;   // dashboardData results
const FIELDS_TTL = 3600; // availableFields metadata

// ─── Permission hook ─────────────────────────────────────────────────────────
// The host application injects its own security model here (roles, row-level
// security, geographic permissions, multi-tenancy, …).
//
// Contract: async ({ userId, roleId, source }) =>
//   { clause: string,           // '' or 'WHERE ...'
//     params: any[],            // ordered params consumed by the clause
//     nextParamIndex: number }  // first free $n placeholder after the clause
let permissionHook = async () => ({ clause: '', params: [], nextParamIndex: 1 });

function setPermissionHook(fn) {
  if (typeof fn !== 'function') throw new Error('setPermissionHook expects an async function');
  permissionHook = fn;
}

function buildArgsHash(args) {
  const normalized = JSON.stringify({
    source: args.source || '',
    fields: [...(args.fields || [])].sort(),
    filters: [...(args.filters || [])].sort((a, b) => a.field.localeCompare(b.field)),
    groupBy: [...(args.groupBy || [])].sort(),
    values: [...(args.values || [])].sort((a, b) => a.field.localeCompare(b.field)),
    limit: args.limit || 5000,
    splitMultiValue: args.splitMultiValue !== false,
    topN: args.topN || null,
  });
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

const resolvers = {
  // Field catalog for the pivot UI — served from the metadata tables.
  availableFields: async (_, args = {}) => {
    const source = args.source || '';
    const cache = getCache();
    const cacheKey = `graphql:availableFields:${source}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const fieldMap = await metadataService.getFieldMap(source);
    const fields = Object.values(fieldMap).map(def => ({
      key: def.key,
      label: def.label,
      category: def.category,
      numeric: !!def.numeric,
      date: !!def.date,
      multiValue: !!def.multiValue,
    }));
    const result = JSON.stringify(fields);
    await cache.set(cacheKey, result, FIELDS_TTL);
    return result;
  },

  // Flexible query for dynamic tables/charts, cached 60s per (user + args).
  dashboardData: async (_, args, context) => {
    const cache = getCache();
    const userId = context?.userId ?? null;
    const argsHash = buildArgsHash(args);
    const cacheKey = `graphql:dashboardData:${userId}:${argsHash}`;

    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const client = await metadataService.getPool().connect();
    try {
      const source = args.source || '';
      const dataSource = await metadataService.getDataSource(source);
      if (!dataSource) throw new Error(`Unknown data source: ${source}`);
      const fieldMap = await metadataService.getFieldMap(source);

      const filters = args.filters || [];
      const groupByFields = args.groupBy || [];
      const valueFields = args.values || [];
      const requestedFields = args.fields || [];
      const limit = args.limit || 5000;
      const splitMultiValue = args.splitMultiValue !== false;

      // 1. Mandatory permission clause (host-injected security)
      const perm = await permissionHook({
        userId,
        roleId: context?.roleId ?? null,
        source,
      });

      // 2. Build the SQL
      const built = buildPivotQuery({
        dataSource,
        fieldMap,
        filters,
        groupBy: groupByFields,
        values: valueFields,
        fields: requestedFields,
        limit,
        splitMultiValue,
        topN: args.topN,
        whereClause: perm.clause || '',
        startParamIndex: perm.nextParamIndex || 1,
      });
      const queryParams = [...(perm.params || []), ...built.params];

      const result = await client.query(built.sql, queryParams);

      const data = {
        columns: built.columns,
        rows: JSON.stringify(result.rows),
        totalRows: result.rows.length,
      };
      await cache.set(cacheKey, data, DATA_TTL);
      return data;
    } finally {
      client.release();
    }
  },
};

module.exports = { resolvers, setPermissionHook };
