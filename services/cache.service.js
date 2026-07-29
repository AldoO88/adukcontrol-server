// Servicio de Cache (Redis)
// Wrapper sobre ioredis con fallback graceful: si Redis no está
// configurado o no responde, las funciones devuelven null/false y el
// caller continúa sin cache.
//
// Configuración (.env):
//   REDIS_URL=redis://localhost:6379   (default)
//   CACHE_TTL_DASHBOARD=300             (segundos, default 5 min)
//
// Uso típico:
//   const cached = await cache.get(key);
//   if (cached) return res.json(cached);
//   const fresh = await compute();
//   await cache.set(key, fresh, ttl);
//   res.json(fresh);
const Redis = require("ioredis");

let client = null;
let enabled = false;

const init = () => {
  if (client) return;
  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false, // no encolar comandos si está desconectado
    maxRetriesPerRequest: 1,     // no reintentar infinitamente
    connectTimeout: 2000,        // 2s timeout para conectar
    retryStrategy: () => null,   // no reintentar (degraded mode)
  });
  client.on("error", (err) => {
    if (enabled) {
      console.warn(`[cache] Redis error: ${err.message}. Falling back to no-cache.`);
    }
    enabled = false;
  });
  client.on("ready", () => {
    enabled = true;
    console.log(`[cache] Redis connected at ${url}`);
  });
  client.on("end", () => {
    enabled = false;
  });
  client.connect().catch(() => {
    // Silencioso: si no se puede conectar, enabled queda en false
    enabled = false;
  });
};

// Inicializar lazy (no bloquea el require)
init();

// Helper interno: ejecutar operación y manejar errores silenciosamente
const safeCall = async (fn) => {
  if (!client || !enabled) return null;
  try {
    return await fn();
  } catch (err) {
    if (enabled) {
      console.warn(`[cache] Operation failed: ${err.message}`);
    }
    return null;
  }
};

// GET: devuelve el valor parseado o null si no existe / Redis caído
const get = async (key) => {
  const raw = await safeCall(() => client.get(key));
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

// SET: guarda un valor (lo serializa a JSON) con TTL en segundos
const set = async (key, value, ttlSeconds = 300) => {
  return safeCall(() => client.set(key, JSON.stringify(value), "EX", ttlSeconds));
};

// DEL: borra una o varias keys
const del = async (...keys) => {
  if (keys.length === 0) return;
  return safeCall(() => client.del(...keys));
};

// SCAN + DEL: borra todas las keys que matcheen un patrón
// (Redis no permite DEL con pattern directamente, hay que usar SCAN)
const invalidatePattern = async (pattern) => {
  if (!client || !enabled) return 0;
  try {
    let cursor = "0";
    let deleted = 0;
    do {
      const [next, keys] = await client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = next;
      if (keys.length > 0) {
        await client.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");
    return deleted;
  } catch (err) {
    if (enabled) console.warn(`[cache] invalidatePattern failed: ${err.message}`);
    return 0;
  }
};

// Stats
const getStats = async () => {
  if (!client || !enabled) return { enabled: false };
  try {
    const info = await client.info("memory");
    return { enabled: true, info: info.split("\n").slice(0, 5) };
  } catch {
    return { enabled: true, error: "could not fetch info" };
  }
};

// Helpers de keys
const keys = {
  dashboard: (userId, period) => `dashboard:${userId}:${period || "all"}`,
  studentGrades: (userId, studentId) =>
    `student-grades:${userId}:${studentId}`,
};

module.exports = {
  get,
  set,
  del,
  invalidatePattern,
  getStats,
  keys,
  // Para tests/debug
  isEnabled: () => enabled,
};
