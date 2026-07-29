// Modelo de Versión de Asset (Cloudinary)
// Mantiene un índice en Mongo de TODAS las versiones de cada asset subido
// (logo de escuela, foto de estudiante). Permite:
//   - Listar el historial de versiones desde la API (sin pegarle a Cloudinary)
//   - Hacer rollback a una versión anterior
//   - Detectar cuál es la versión "actual" rápidamente
//
// Una sola colección para todos los tipos de asset (multi-tenant SaaS);
// el campo `entity_type` discrimina entre school y student.
const { Schema, model } = require("mongoose");

const assetVersionSchema = new Schema(
  {
    // Tipo de entidad a la que pertenece el asset
    entity_type: {
      type: String,
      required: [true, "entity_type is required."],
      enum: {
        values: ["school", "student"],
        message: "entity_type must be: school or student.",
      },
      index: true,
    },
    // ObjectId de la entidad (School o Student) — tenant-agnostic en este modelo
    // porque la referencia polimórfica se valida en el controller.
    entity_id: {
      type: Schema.Types.ObjectId,
      required: [true, "entity_id is required."],
      index: true,
    },
    // Public ID de Cloudinary (carpeta + nombre)
    public_id: {
      type: String,
      required: [true, "public_id is required."],
      trim: true,
    },
    // URL segura devuelta por Cloudinary
    url: {
      type: String,
      required: [true, "url is required."],
      trim: true,
    },
    // Metadata opcional devuelta por Cloudinary
    width: { type: Number },
    height: { type: Number },
    format: { type: String, trim: true },
    bytes: { type: Number },
    // Solo una versión por (entity_type, entity_id) puede ser "current"
    is_current: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Usuario que subió la versión (opcional; útil para auditoría)
    uploaded_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Soft-delete: cuando el cleanup job determina que esta versión ya no
    // está en uso, marca deletedAt en lugar de borrar el registro.
    // Las queries por default lo filtran (deletedAt: null implícito en
    // los controllers); las queries de admin pueden incluirlo explícitamente.
    // El TTL index borra físicamente después de 90 días.
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Índice compuesto para encontrar la versión actual rápidamente
assetVersionSchema.index(
  { entity_type: 1, entity_id: 1, is_current: 1 },
  {
    name: "current_version",
    // Solo indexa documentos con is_current: true (sparse-like)
    partialFilterExpression: { is_current: true },
  }
);

// Índice para listar historial de versiones ordenado por fecha
assetVersionSchema.index({ entity_type: 1, entity_id: 1, createdAt: -1 });

// TTL index sobre deletedAt: el documento se BORRA FÍSICAMENTE 90 días
// después de marcado como soft-deleted. Como Mongo solo aplica el TTL a
// docs donde deletedAt es una fecha (no null), los registros vivos no se
// ven afectados. Mantiene la colección con tamaño acotado.
assetVersionSchema.index(
  { deletedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90, name: "soft_delete_ttl" }
);

const AssetVersion = model("AssetVersion", assetVersionSchema);

module.exports = AssetVersion;
