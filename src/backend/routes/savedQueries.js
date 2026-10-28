// routes/savedQueries.js
// REST endpoints for saved queries (CRUD + pins + access grants).
//
// The host application must mount this router BEHIND its own authentication
// middleware and guarantee that req.user = { id, roleId } is set before the
// router runs (see middleware/requireHostUser.js).

const express = require('express');

module.exports = function createSavedQueriesRouter({ pool }) {
  const router = express.Router();

  // The host app provides the authenticated user (req.user = { id, roleId }).
  const requireUser = (req, res, next) => {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Authentication required (req.user missing).' });
    }
    next();
  };

  router.use(requireUser);

  // ─── List (visible to: owner, public, or granted users/roles) ──────────────
  router.get('/saved-queries', async (req, res) => {
    const userId = req.user.id;
    const roleId = req.user.roleId ?? 0;
    const { source } = req.query;
    try {
      const hasSource = !!source;
      const params = hasSource ? [userId, roleId, source] : [userId, roleId];
      const { rows } = await pool.query(
        `SELECT sq.*
         FROM pivot_saved_queries sq
         WHERE sq.deleted_at IS NULL
           AND (
               sq.visibility = 'public'
               OR sq.created_by = $1
               OR EXISTS (SELECT 1 FROM pivot_saved_query_access sqa
                          WHERE sqa.query_id = sq.id AND sqa.user_id = $1)
               OR EXISTS (SELECT 1 FROM pivot_saved_query_access sqa
                          WHERE sqa.query_id = sq.id AND sqa.role_id = $2)
           )
           ${hasSource ? 'AND sq.source_key = $3' : ''}
         ORDER BY sq.updated_at DESC`,
        params(userId, roleId, source)
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'Error listing saved queries', detail: err.message });
    }
  });

  // ─── Get one ───────────────────────────────────────────────────────────────
  router.get('/saved-queries/:id', async (req, res) => {
    const userId = req.user.id;
    const roleId = req.user.roleId ?? 0;
    try {
      const { rows } = await pool.query(
        `SELECT sq.* FROM pivot_saved_queries sq
         WHERE sq.id = $1 AND sq.deleted_at IS NULL
           AND (
             sq.visibility = 'public'
             OR sq.created_by = $2
             OR EXISTS (SELECT 1 FROM pivot_saved_query_access sqa WHERE sqa.query_id = sq.id AND sqa.user_id = $2)
             OR EXISTS (SELECT 1 FROM pivot_saved_query_access sqa WHERE sqa.query_id = sq.id AND sqa.role_id = $3)
           )`,
        [req.params.id, userId, roleId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Query not found or no access.' });
      const { rows: accesses } = await pool.query(
        'SELECT * FROM pivot_saved_query_access WHERE query_id = $1',
        [req.params.id]
      );
      res.json({ ...rows[0], shared_with: accesses });
    } catch (err) {
      res.status(500).json({ error: 'Error fetching saved query', detail: err.message });
    }
  });

  // ─── Create ────────────────────────────────────────────────────────────────
  router.post('/saved-queries', async (req, res) => {
    const { name, description, pivot_config, chart_config, visibility } = req.body;
    try {
      if (!name || !pivot_config) {
        return res.status(400).json({ error: 'name and pivot_config are required.' });
      }
      const pinTable = !!(chart_config && chart_config.pinTable);
      const pinChart = !!(chart_config && chart_config.pinChart);
      const sourceKey = pivot_config?.source || null;

      const { rows } = await pool.query(
        `INSERT INTO pivot_saved_queries
            (name, description, source_key, pivot_config, chart_config, visibility, pin_table, pin_chart, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          name,
          description || null,
          sourceKey,
          JSON.stringify(pivot_config),
          JSON.stringify(chart_config || {}),
          visibility || 'private',
          pinTable,
          pinChart,
          req.user.id,
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Error creating saved query', detail: err.message });
    }
  });

  // ─── Update (owner only) ───────────────────────────────────────────────────
  router.put('/saved-queries/:id', async (req, res) => {
    const { id } = req.params;
    const { name, description, pivot_config, chart_config, visibility } = req.body;
    try {
      const own = await assertOwner(id, req.user.id);
      if (!own.ok) return res.status(own.status).json({ error: own.error });

      const pinTable = chart_config && Object.prototype.hasOwnProperty.call(chart_config, 'pinTable')
        ? !!chart_config.pinTable : null;
      const pinChart = chart_config && Object.prototype.hasOwnProperty.call(chart_config, 'pinChart')
        ? !!chart_config.pinChart : null;

      const { rows } = await pool.query(
        `UPDATE pivot_saved_queries SET
            name = COALESCE($1, name),
            description = COALESCE($2, description),
            pivot_config = COALESCE($3, pivot_config),
            chart_config = COALESCE($4, chart_config),
            visibility = COALESCE($5, visibility),
            pin_table = COALESCE($6, pin_table),
            pin_chart = COALESCE($7, pin_chart),
            updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [
          name || null,
          description !== undefined ? description : null,
          pivot_config ? JSON.stringify(pivot_config) : null,
          chart_config ? JSON.stringify(chart_config) : null,
          visibility || null,
          pinTable,
          pinChart,
          id,
        ]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Error updating saved query', detail: err.message });
    }
  });

  // ─── Delete (soft) ─────────────────────────────────────────────────────────
  router.delete('/saved-queries/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const own = await assertOwner(id, req.user.id);
      if (!own.ok) return res.status(own.status).json({ error: own.error });
      await pool.query(
        'UPDATE pivot_saved_queries SET deleted_at = NOW() WHERE id = $1',
        [req.params.id]
      );
      res.json({ message: 'Query deleted.' });
    } catch (err) {
      res.status(500).json({ error: 'Error deleting saved query', detail: err.message });
    }
  });

  // ─── Toggle pin ────────────────────────────────────────────────────────────
  router.put('/saved-queries/:id/pin', async (req, res) => {
    const { target, value } = req.body;
    if (!['table', 'chart'].includes(target)) {
      return res.status(400).json({ error: "target must be 'table' or 'chart'." });
    }
    const col = target === 'table' ? 'pin_table' : 'pin_chart';
    try {
      const { rows } = await pool.query(
        `UPDATE pivot_saved_queries SET ${col} = $1, updated_at = NOW()
         WHERE id = $2 AND created_by = $3 AND deleted_at IS NULL
         RETURNING id, name, pin_table, pin_chart`,
        [!!req.body.value, req.params.id, req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Query not found or not owner.' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Error toggling pin', detail: err.message });
    }
  });

  // ─── Share access (user or role) ───────────────────────────────────────────
  router.post('/saved-queries/:id/grant', async (req, res) => {
    const { user_id, role_id } = req.body;
    if (!user_id && !role_id) {
      return res.status(400).json({ error: 'user_id or role_id required.' });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO pivot_saved_query_access (query_id, user_id, role_id, granted_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [req.params.id, user_id || null, role_id || null, req.user.id]
      );
      if (!rows.length) return res.json({ message: 'Access already granted.' });
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Error granting access', detail: err.message });
    }
  });

  router.delete('/saved-queries/:id/grant', async (req, res) => {
    const { user_id, role_id } = req.body;
    if (!user_id && !role_id) {
      return res.status(400).json({ error: 'user_id or role_id required.' });
    }
    try {
      const sql = user_id
        ? 'DELETE FROM pivot_saved_query_access WHERE query_id = $1 AND user_id = $2'
        : 'DELETE FROM pivot_saved_query_access WHERE query_id = $1 AND role_id = $2';
      await pool.query(sql, [req.params.id, user_id || role_id]);
      res.json({ message: 'Access revoked.' });
    } catch (err) {
      res.status(500).json({ error: 'Error revoking access', detail: err.message });
    }
  });

  // ─── Helpers ───────────────────────────────────────────────────────────────
  async function assertOwner(queryId, userId) {
    const { rows } = await pool.query(
      'SELECT created_by FROM pivot_saved_queries WHERE id = $1 AND deleted_at IS NULL',
      [queryId]
    );
    if (!rows.length) return { ok: false, status: 404, error: 'Query not found.' };
    if (String(rows[0].created_by) !== String(userId)) {
      return { ok: false, status: 403, error: 'Only the creator can perform this action.' };
    }
    return { ok: true };
  }

  function params(userId, roleId, source) {
    return source ? [userId, roleId, source] : [userId, roleId];
  }

  return router;
};
