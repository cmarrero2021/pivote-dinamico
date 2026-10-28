-- ═══════════════════════════════════════════════════════════════════════════
-- dash-pivot · migration 0001 — initial metadata schema
-- Creates the infrastructure tables the package needs IN THE HOST DATABASE:
--   • pivot_datasources        → which schemas/tables/views are exposed
--   • pivot_fields             → which columns, labels, categories, types
--   • pivot_saved_queries      → user-saved pivot configurations
--   • pivot_saved_query_access → per-user / per-role sharing grants
-- These tables are generic; they contain NO domain-specific logic.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Registered data sources (tables / views / foreign tables) ──────────────
CREATE TABLE IF NOT EXISTS pivot_datasources (
    id           SERIAL PRIMARY KEY,
    source_key   TEXT        NOT NULL UNIQUE,   -- key used by the frontend (e.g. 'ventas')
    display_name TEXT        NOT NULL,
    schema_name  TEXT        NOT NULL,
    table_name   TEXT        NOT NULL,
    table_type   TEXT        NOT NULL DEFAULT 'table',  -- 'table' | 'view' | 'foreign'
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pivot_datasources_unique UNIQUE (source_key)
);

-- ─── Enabled fields per data source ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pivot_fields (
    id            SERIAL PRIMARY KEY,
    datasource_id INTEGER NOT NULL REFERENCES pivot_datasources(id) ON DELETE CASCADE,
    field_key     TEXT    NOT NULL,               -- key used by the frontend
    column_name   TEXT    NOT NULL,               -- physical column name
    display_label TEXT    NOT NULL,               -- human label shown in the UI
    category      TEXT    NOT NULL DEFAULT 'General',
    field_type    TEXT    NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'numeric', 'date')),
    is_multivalue BOOLEAN NOT NULL DEFAULT FALSE, -- comma-separated values column
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (datasource_id, field_key)
);

CREATE INDEX IF NOT EXISTS pivot_fields_datasource_idx
    ON pivot_fields (datasource_id) WHERE is_active = TRUE;

-- ─── Saved queries ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pivot_saved_queries (
    id           BIGSERIAL PRIMARY KEY,
    name         TEXT        NOT NULL,
    description  TEXT,
    source_key   TEXT,                           -- data source this query runs on
    pivot_config JSONB       NOT NULL,           -- rows/columns/values/filters/…
    chart_config JSONB       DEFAULT '{}',
    visibility   TEXT        NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
    pin_table    BOOLEAN     NOT NULL DEFAULT FALSE,
    pin_chart    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_by   BIGINT      NOT NULL,           -- host app user id
    deleted_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pivot_saved_queries_created_by_idx
    ON pivot_saved_queries (created_by) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pivot_saved_queries_pin_table_idx
    ON pivot_saved_queries (created_by) WHERE pin_table = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pivot_saved_queries_pin_chart_idx
    ON pivot_saved_queries (created_by) WHERE pin_chart = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pivot_saved_queries_source_idx
    ON pivot_saved_queries (source_key) WHERE deleted_at IS NULL;

-- ─── Sharing grants (per user or per role of the host app) ──────────────────
CREATE TABLE IF NOT EXISTS pivot_saved_query_access (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    query_id   BIGINT NOT NULL REFERENCES pivot_saved_queries(id) ON DELETE CASCADE,
    user_id    BIGINT,
    role_id    BIGINT,
    granted_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pivot_sqa_user_or_role CHECK (user_id IS NOT NULL OR role_id IS NOT NULL)
);

COMMIT;
