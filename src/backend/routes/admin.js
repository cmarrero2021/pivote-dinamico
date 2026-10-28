// routes/admin.js
// Admin REST API for managing data sources and fields (the "mark schemas,
// tables, views and columns as manageable" capability). A host application can
// build its own admin UI on top of these endpoints, or use the admin UI
// component shipped with the package.
//
// SECURITY: mount this router only for administrator users of the host app.
// The host is fully responsible for the authorization middleware guarding it.

const express = require('express');
const metadataService = require('../services/metadataService');
const fieldCatalog = require('../services/fieldCatalog');

module.exports = function createAdminRouter({ pool }) {
  const router = express.Router();

  // ─── Data sources ──────────────────────────────────────────────────────────

  router.get('/datasources', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT d.*,
                (SELECT COUNT(*) FROM pivot_fields f
                  WHERE f.datasource_id = d.id AND f.is_active = TRUE) AS active_fields
         FROM pivot_datasources d
         ORDER BY d.schema_name, d.table_name`
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'Error listing datasources', detail: err.message });
    }
  });

  router.post('/datasources', async (req, res) => {
    const { source_key, display_name, schema_name, table_name, table_type } = req.body;
    try {
      if (!source_key || !schema_name || !table_name) {
        return res.status(400).json({ error: 'source_key, schema_name and table_name are required.' });
      }
      // Verify the object physically exists before registering it.
      const { rows: exists } = await pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = $2 LIMIT 1`,
        [schema_name, table_name]
      );
      if (!exists.rows.length) {
        return res.status(400).json({ error: `Schema.table ${schema_name}.${table_name} does not exist.` });
      }
      const { rows } = await pool.query(
        `INSERT INTO pivot_datasources (source_key, display_name, schema_name, table_name, table_type)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_key) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           schema_name = EXCLUDED.schema_name,
           table_name = EXCLUDED.table_name,
           table_type = EXCLUDED.table_type,
           is_active = TRUE,
           updated_at = NOW()
         RETURNING *`,
        [source_key, display_name || source_key, schema_name, table_name, table_type || 'table']
      );
      await metadataService.invalidate(source_key);
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Error creating data source', detail: err.message });
    }
  });

  router.put('/datasources/:id', async (req, res) => {
    const { id } = req.params;
    const { display_name, is_active } = req.body;
    try {
      const { rows } = await pool.query(
        `UPDATE pivot_datasources SET
            display_name = COALESCE($1, display_name),
            is_active = COALESCE($2, is_active)
         WHERE id = $3
         RETURNING *`,
        [display_name ?? null, is_active === undefined ? null : !!is_active, id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Data source not found.' });
      await metadataService.invalidate(rows[0].source_key);
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Error updating datasource', detail: err.message });
    }
  });

  // ─── Column auto-detection ─────────────────────────────────────────────────

  // Autodetects the columns of a data source (from information_schema).
  router.get('/datasources/:id/columns', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT schema_name, table_name FROM pivot_datasources WHERE id = $1',
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Data source not found.' });
      const columns = await fieldCatalog.detectColumns(rows[0]);
      res.json(columns);
    } catch (err) {
      res.status(500).json({ error: 'Error detecting columns', detail: err.message });
    }
  });

  // List the saved (enabled or previously enabled) fields of a data source.
  router.get('/datasources/:id/fields', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, field_key, column_name, display_label, category, field_type, is_multivalue, is_active
         FROM pivot_fields
         WHERE datasource_id = $1
         ORDER BY category, display_label`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'Error listing fields', detail: err.message });
    }
  });

  // Bulk-enable fields for a data source.
  // Body: { fields: [{ field_key, column_name, display_label, category, field_type, is_multivalue }] }
  router.post('/datasources/:id/fields', async (req, res) => {
    const fields = req.body.fields;
    if (!Array.isArray(fields)) return res.status(400).json({ error: 'fields array required.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const f of fields) {
        await client.query(
          `INSERT INTO pivot_fields
              (datasource_id, field_key, column_name, display_label, category, field_type, is_multivalue, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
           ON CONFLICT (datasource_id, field_key) DO UPDATE SET
              column_name = EXCLUDED.column_name,
              display_label = EXCLUDED.display_label,
              category = EXCLUDED.category,
              field_type = EXCLUDED.field_type,
              is_multivalue = EXCLUDED.is_multivalue,
              is_active = EXCLUDED.is_active`,
          [
            req.params.id,
            f.field_key || f.column_name,
            f.column_name,
            f.display_label || f.field_key,
            f.category || 'General',
            f.field_type || 'text',
            !!f.is_multivalue,
          ]
        );
      }
      await client.query('COMMIT');
      await metadataService.invalidate();
      res.json({ message: `Saved ${fields.length} fields.` });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Error saving fields', detail: err.message });
    }
  });

  // Update a single field (label, category, type, multivalue, active).
  router.put('/fields/:id', async (req, res) => {
    const { id } = req.params;
    const { display_label, category, field_type, is_multivalue, is_active } = req.body;
    try {
      const { rows } = await pool.query(
        `UPDATE pivot_fields SET
            display_label = COALESCE($1, display_label),
            category = COALESCE($2, category),
            field_type = COALESCE($3, field_type),
            is_multivalue = COALESCE($4, is_multivalue),
            is_active = COALESCE($5, is_active)
         WHERE id = $6
         RETURNING *`,
        [
          display_label ?? null,
          category ?? null,
          field_type || null,
          is_multivalue === undefined ? null : !!is_multivalue,
          is_active === undefined ? null : !!is_active,
          id,
        ]
      );
      if (!rows.length) return res.status(404).json({ error: 'Field not found.' });
      await metadataService.invalidate();
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Error updating field', detail: err.message });
    }
  });

  // Validate that active fields still exist on the physical table.
  router.get('/datasources/validate/:source', async (req, res) => {
    try {
      const stale = await fieldCatalog.validateSourceColumns(req.params.source);
      res.json({ source: req.params.source, staleFields: stale });
    } catch (err) {
      res.status(500).json({ error: 'Error validating source', detail: err.message });
    }
  });

  return router;
};
