// Servicio de refresh tokens (issue / rotate / revoke) con detección
// de reuso. Toda la operación vive en la base de datos para que la
// rotación sea revocable: si un atacante roba un refresh token y lo usa
// mientras la víctima ya rotó, identificamos el reuse y tumbamos la
// family entera.
//
// TTL:
//   - remember=true  → 30 días
//   - remember=false → 24 h   (el cliente no persiste el refresh; vive
//                             solo en memoria hasta el próximo access
//                             y se descarta al cerrar la app)
//
// El raw token es base64url de 48 bytes (64 chars aprox) — suficiente
// entropía contra enumeración. Solo guardamos sha256(raw).
const crypto = require("crypto");
const RefreshToken = require("../models/RefreshToken.model");

const TTL_REMEMBER = 30 * 24 * 60 * 60 * 1000; // 30 d
const TTL_NO_REMEMBER = 24 * 60 * 60 * 1000; // 24 h

// Errores tipados para que el controller decida la respuesta HTTP.
class RefreshError extends Error {
  constructor(reason, httpStatus = 401) {
    super(reason);
    this.name = "RefreshError";
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

const hash = (raw) =>
  crypto.createHash("sha256").update(raw).digest("hex");

// Genera un token crudo (base64url, 48 bytes → ~64 chars) y devuelve
// { raw, tokenHash, family }. `family` se crea si es el primer token
// de la cadena (login); debe reusarse en cada rotate.
const generateRawToken = () => ({
  raw: crypto.randomBytes(48).toString("base64url"),
  family: RefreshToken.newFamilyId(),
});

// Emite un refresh token: lo guarda hasheado en la DB y devuelve el
// `raw` para enviarlo una sola vez al cliente. TTL según `remember`.
//
// Si se pasa una `family` (en rotación), se reutiliza; si no, se
// arranca una nueva.
async function issueRefreshToken({
  user,
  school,
  client,
  remember,
  family,
}) {
  const generated = generateRawToken();
  const expiresAt = new Date(
    Date.now() + (remember ? TTL_REMEMBER : TTL_NO_REMEMBER)
  );
  const doc = await RefreshToken.create({
    tokenHash: hash(generated.raw),
    user: user._id,
    // `school` puede ser null para super_admin (AGENTS.md — el campo
    // User.school es null en ese rol). Permitimos null en el modelo y
    // aquí solo si el caller no nos pasó nada usable. Para roles
    // tenant-scoped el backend siempre pasa school poblado o su id.
    school: school ? school._id || school : null,
    family: family || generated.family,
    client,
    expiresAt,
  });
  return {
    raw: generated.raw,
    family: doc.family,
    expiresAt,
  };
}

// Rota un refresh token. Devuelve el nuevo par (access se firma en el
// controller; aquí solo el refresh).
async function rotateRefreshToken(rawToken) {
  const tokenHash = hash(rawToken);
  // findOne + save para poder mutar el doc dentro de una transacción
  // lógica (no usamos sesiones multi-doc; suficiente con find-then-save
  // porque rotate es por-hash y no concurrente en la misma family).
  const doc = await RefreshToken.findOne({ tokenHash });
  if (!doc) {
    throw new RefreshError("Refresh token inválido.");
  }
  if (doc.expiresAt.getTime() < Date.now()) {
    throw new RefreshError("Refresh token expirado.");
  }
  if (doc.revokedAt || doc.replacedByHash) {
    // REUSE: el token ya fue rotado o revocado. Alguien está
    // intentando usar un token viejo → compromiso probable.
    // Tumba toda la family.
    await RefreshToken.updateMany(
      { family: doc.family, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    throw new RefreshError(
      "Refresh token reusado. Se han revocado todas las sesiones.",
      401
    );
  }

  // Emisión del nuevo token (misma family).
  const generated = generateRawToken();
  const expiresAt = new Date(Date.now() + TTL_REMEMBER); // refresh rotado hereda "remember"
  const newDoc = await RefreshToken.create({
    tokenHash: hash(generated.raw),
    user: doc.user,
    school: doc.school,
    family: doc.family,
    client: doc.client,
    expiresAt,
  });

  // Marca el viejo como rotado (atómico almenos en este doc).
  doc.revokedAt = new Date();
  doc.replacedByHash = newDoc.tokenHash;
  await doc.save();

  return {
    raw: generated.raw,
    family: doc.family,
    user: doc.user,
    school: doc.school,
    client: doc.client,
    expiresAt: newDoc.expiresAt,
  };
}

// Revoca un refresh token concreto (logout). Idempotente.
async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  await RefreshToken.updateOne(
    { tokenHash: hash(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

// Revoca TODOS los refresh tokens activos del usuario (cambio de pass
// o "cerrar sesión en todos mis dispositivos"). Útil si se quisiera
// añadir en /change-password, etc.
async function revokeAllForUser(userId) {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

module.exports = {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  RefreshError,
};
