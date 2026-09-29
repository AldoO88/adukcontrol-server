// Refresh tokens persistentes (rotación con detección de reuso).
//
// Almacenamos SOLO el sha256 del token crudo — el raw nunca se guarda,
// así una fuga de la colección no compromete sesiones activas. Los
// tokens crudos viven solo en el cliente (y opcionalmente una sola vez
// en tránsito en la respuesta de /auth/login).
//
// Esquema:
//   - family: agrupa una cadena de rotación originada en un mismo login.
//     Si un refresh de la family ya aparece como `revokedAt` o
//     `replacedByHash`, eso es REUSE — probable robo — y la family
//     entera queda revocada (forzando re-login en todos los
//     dispositivos de ese usuario).
//   - client: 'web' | 'app' — facilita revocaciones masivas por
//     plataforma si se descubre una vulnerabilidad.
//   - expiresAt: índice TTL de Mongo (auto-limpieza).
//   - school: obligatorio por la regla multi-tenant del repo
//     (AGENTS.md — todo documento con datos school-scoped debe
//     incluir el campo `school`).
const { Schema, model, Types } = require("mongoose");

const refreshTokenSchema = new Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      // `super_admin` no tiene school asignado en este repo (ver
      // AGENTS.md, regla multi-tenant). Permitimos null para no
      // romper su login cuando el flow de refresh se activa.
      required: false,
      default: null,
      index: true,
    },
    family: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    client: {
      type: String,
      enum: ["web", "app"],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      // Mongo borra el documento al llegar la fecha.
      index: { expireAfterSeconds: 0 },
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    replacedByHash: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

// Lookup principal por familia: permite "revocar todos los refresh
// tokens de esta family" en una sola operación cuando se detecta reuse.
refreshTokenSchema.index({ family: 1, revokedAt: 1 });

const RefreshToken = model("RefreshToken", refreshTokenSchema);

// Helper exportado para generar family nueva (un ObjectId al azar).
RefreshToken.newFamilyId = () => new Types.ObjectId();

module.exports = RefreshToken;
