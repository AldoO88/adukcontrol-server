// Servicio de Server-Sent Events (SSE)
// Maneja suscriptores por user_id para notificar al frontend cuando
// eventos asíncronos completan (ej. retry de upload exitoso).
//
// El flujo:
//   1. Frontend hace GET /api/uploads/events con Authorization: Bearer <jwt>
//   2. El server agrega el stream a un Set por user_id
//   3. Cuando el cron job completa un retry, llama notify(userId, event)
//   4. El server escribe el evento a todos los streams de ese user
//   5. El cliente cierra la conexión en logout
//
// Limitaciones de SSE (vs WebSocket):
//   - Unidireccional (server → client). No hay canal cliente → server.
//   - Un solo stream por user. Si el user abre 2 tabs, ambos reciben.
//   - Auto-reconexión nativa del navegador si la conexión se cae.

const subscribersByUser = new Map(); // userId -> Set<res>

// Suscribe un response (stream SSE) a los eventos de un usuario.
const addSubscriber = (userId, res) => {
  if (!subscribersByUser.has(userId)) {
    subscribersByUser.set(userId, new Set());
  }
  subscribersByUser.get(userId).add(res);
};

// Desuscribe cuando el cliente cierra la conexión.
const removeSubscriber = (userId, res) => {
  const set = subscribersByUser.get(userId);
  if (set) {
    set.delete(res);
    if (set.size === 0) subscribersByUser.delete(userId);
  }
};

// Envía un evento a todos los streams de un usuario.
// `event` es el nombre del evento SSE; `data` es el payload (objeto → JSON).
const notify = (userId, event, data) => {
  const set = subscribersByUser.get(String(userId));
  if (!set || set.size === 0) return 0;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let delivered = 0;
  for (const res of set) {
    try {
      res.write(payload);
      delivered++;
    } catch (err) {
      // Stream probablemente cerrado, limpiar
      set.delete(res);
    }
  }
  return delivered;
};

// Helper para mantener viva la conexión SSE (evita que se cierre por timeout
// de proxies o load balancers).
const KEEPALIVE_INTERVAL_MS = 30 * 1000; // 30s
const startKeepalive = (res) => {
  return setInterval(() => {
    try {
      res.write(`: keepalive\n\n`); // comentario SSE
    } catch (e) {
      // Stream cerrado, el setInterval se limpia desde el controller
    }
  }, KEEPALIVE_INTERVAL_MS);
};

// Stats para debug
const getStats = () => {
  let totalConnections = 0;
  for (const set of subscribersByUser.values()) totalConnections += set.size;
  return {
    unique_users: subscribersByUser.size,
    total_connections: totalConnections,
  };
};

module.exports = {
  addSubscriber,
  removeSubscriber,
  notify,
  startKeepalive,
  getStats,
};
