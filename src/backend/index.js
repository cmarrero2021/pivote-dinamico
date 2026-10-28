// index.js — package entry point (backend)
//
// Usage in the host application:
//
//   const { createPivotBackend } = require('dash-pivot');
//
//   const pivot = createPivotBackend({ pool });   // your pg Pool (ONE DB/project)
//
//   // 1. Security — inject YOUR permission logic (roles, RLS, multi-tenant…)
//   pivot.setPermissionHook(async ({ userId, roleId, source }) => ({
//     clause: 'WHERE t.owner_id = $1',   // '' when no restriction
//     params: [userId],
//     nextParamIndex: 2,                 // first free $n after the clause
//   }));
//
//   // 2. Mount on your Express app:
//   app.use('/api/pivot', pivot.savedQueriesRouter);   // REST saved queries
//   app.use('/api/pivot-admin', yourAdminAuth, pivot.adminRouter); // admin API
//   app.all(['/graphql', '/api/graphql'], yourAuthMiddleware, pivot.graphqlHandler);
//
// The frontend talks to /graphql (GraphQL) and basePath/saved-queries (REST).

const { schema } = require('./graphql/schema');
const { resolvers, setPermissionHook } = require('./graphql/resolvers');
const metadataService = require('./services/metadataService');
const fieldCatalog = require('./services/fieldCatalog');
const { setCache, getCache, defaultCache } = require('./services/cacheService');
const { setDialect } = require('./dialects');
const { buildPivotQuery } = require('./services/pivotQueryBuilder');

function createPivotBackend({
  pool,
  cache,                // optional Redis-compatible adapter { get, set, del, delByPrefix }
  dialect = 'postgres',
  graphqlContext = null, // optional (req) => context for GraphQL
}) {
  // ─── Initialize services ────────────────────────────────────────────────────
  setCache(cache);
  setDialect(dialect);
  metadataService.init({ pgPool: pool });
  fieldCatalog.init({ pgPool: pool });

  const savedQueriesRouter = require('./routes/savedQueries')({ pool });
  const adminRouter = require('./routes/admin')({ pool });

  // GraphQL handler — resolves per-request context from req.user
  // ({ id, roleId }) which the host's auth middleware must set.
  function mountGraphQL(app, { path = '/graphql', requireAuth } = {}) {
    const { createHandler } = require('graphql-http/lib/use/express');
    app.all(path, (req, res, next) => {
      if (requireAuth) requireAuth(req, res, () => {
        createHandler({
          schema,
          context: () => graphqlContext
            ? graphqlContext(req)
            : { userId: req.user?.id ?? null, roleId: req.user?.roleId ?? null },
        })(req, res);
      });
      else {
        createHandler({ schema, context: () => ({ userId: req.user?.id ?? null, roleId: req.user?.roleId ?? null }) })(req, res);
      }
    });
  }

  return {
    // REST routers (host decides the authorization middleware for each)
    savedQueriesRouter,
    adminRouter,
    // GraphQL: mount(schema) on the paths the host chooses
    graphql: { schema, resolvers, mountGraphQL },
    // Security injection
    setPermissionHook,
    // Advanced access to internals
    metadata: metadataService,
    fieldCatalog,
    queryBuilder: { buildPivotQuery },
    cache: getCache(),
  };
}

module.exports = {
  createPivotBackend,
  setPermissionHook,
  setDialect,
  buildPivotQuery,
  metadataService,
  fieldCatalog,
  setCache,
  defaultCache,
};
