// src/frontend/admin/adminApi.js
// Thin REST client for the package's admin API (metadata management).
// Uses the HTTP client + base path configured via configurePivotApi().
//
// SECURITY: these endpoints must be mounted by the host behind its own
// administrator authorization middleware.

import { getHttp, getBasePath } from '../http';

const adminUrl = (suffix) => `${getBasePath()}/admin${suffix}`;

export const pivotAdminApi = {
  // ─── Data sources ──────────────────────────────────────────────────────
  listDatasources: () =>
    getHttp().get(`${getBasePath()}/admin/datasources`),

  createDatasource: ({ source_key, display_name, schema_name, table_name, table_type }) =>
    getHttp().post(`${getBasePath()}/admin/datasources`, {
      source_key, display_name, schema_name, table_name, table_type,
    }),

  updateDatasource: (id, patch) =>
    getHttp().put(`${getBasePath()}/admin/datasources/${id}`, patch),

  // ─── Fields ────────────────────────────────────────────────────────────
  detectColumns: (datasourceId) =>
    getHttp().get(`${getBasePath()}/admin/datasources/${datasourceId}/columns`),

  listFields: (datasourceId) =>
    getHttp().get(`${getBasePath()}/admin/datasources/${datasourceId}/fields`),

  saveFields: (datasourceId, fields) =>
    getHttp().post(`${getBasePath()}/admin/datasources/${datasourceId}/fields`, { fields }),

  updateField: (fieldId, patch) =>
    getHttp().put(`${getBasePath()}/admin/fields/${fieldId}`, patch),

  validateSource: (sourceKey) =>
    getHttp().get(`${getBasePath()}/admin/datasources/validate/${encodeURIComponent(sourceKey)}`),
};
