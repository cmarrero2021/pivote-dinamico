// services/cacheService.js
// Minimal in-memory TTL cache. Hosts can inject a Redis-compatible adapter
// (get/set/keys/del) via createPivotBackend({ cache }) to share cache across
// processes or invalidate from DB listeners.

const defaultCache = (() => {
  const store = new Map(); // key → { value, expiresAt }

  return {
    async get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      if (hit.expiresAt && hit.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    async set(key, value, ttlSeconds = 60) {
      store.set(key, { value, expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null });
    },
    async del(key) {
      store.delete(key);
    },
    async delByPrefix(prefix) {
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
      }
    },
  };
})();

let cache = defaultCache;

function setCache(custom) {
  if (custom) cache = custom;
}

function getCache() {
  return cache;
}

module.exports = { setCache, getCache, defaultCache };
