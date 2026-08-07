// Modelo de Aviso (Announcement)
// Mensajes publicados por el personal de la escuela hacia audiencias
// específicas (toda la escuela, ciertos grupos, o ciertos alumnos).
//
// El control de QUIÉN puede crear avisos según su role (principal, prefect,
// teacher) y el SCOPE de cada uno vive en el controller — la DB solo
// persiste el resultado. Esto permite que un mismo esquema sirva para
// todos los roles sin duplicar colecciones.
//
// Regla multi-tenant: cada aviso pertenece a UNA escuela.
const { Schema, model } = require("mongoose");

const announcementSchema = new Schema(
  {
    // -------- Contexto / Tenant --------
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Ciclo escolar al que pertenece el aviso. Permite filtrar fácilmente
    // los avisos históricos por año y separar los vigentes del ciclo actual.
    schoolYear: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
      index: true,
    },
    // Usuario que creó el aviso (principal, prefect, teacher, admin, etc.).
    // El controller valida que el role del sender tenga permiso de publicar
    // en el scope elegido.
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Sender is required."],
    },

    // -------- Contenido --------
    title: {
      type: String,
      required: [true, "Title is required."],
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: [true, "Message is required."],
      maxlength: 5000,
    },
    priority: {
      type: String,
      required: [true, "Priority is required."],
      enum: {
        values: ["informative", "urgent"],
        message: "priority must be: informative or urgent.",
      },
      default: "informative",
    },

    // -------- Alcance (polimórfico) --------
    // Define a QUIÉN va dirigido el aviso:
    //   "general"  → toda la escuela (broadcast)
    //   "group"    → uno o varios grupos (usa targetGroups)
    //   "student"  → uno o varios alumnos (usa targetStudents)
    targetType: {
      type: String,
      required: [true, "targetType is required."],
      enum: {
        values: ["general", "group", "student"],
        message: "targetType must be: general, group or student.",
      },
    },
    // Grupos destino. OBLIGATORIO (no vacío) si targetType === "group".
    // En cualquier otro caso debe estar vacío (lo valida el pre("validate")).
    targetGroups: {
      type: [Schema.Types.ObjectId],
      ref: "Group",
      default: [],
    },
    // Alumnos destino. OBLIGATORIO (no vacío) si targetType === "student".
    // En cualquier otro caso debe estar vacío (lo valida el pre("validate")).
    targetStudents: {
      type: [Schema.Types.ObjectId],
      ref: "Student",
      default: [],
    },

    // -------- Configuración --------
    // Si está seteado, el aviso se considera "vencido" cuando llega esa
    // fecha. La query del controller debe filtrar:
    //   { $or: [ { expiresAt: null }, { expiresAt: { $gt: now } } ] }
    // NO usamos TTL de MongoDB (expireAfterSeconds) porque queremos
    // mantener el registro en DB para auditoría y para mostrarlo
    // explícitamente como "vencido" si el staff lo consulta.
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// -------- Validaciones cross-field del scope polimórfico --------
// Garantiza la coherencia entre targetType y los arrays:
//   - targetType "general"  → ambos arrays vacíos
//   - targetType "group"    → targetGroups no vacío, targetStudents vacío
//   - targetType "student"  → targetStudents no vacío, targetGroups vacío
announcementSchema.pre("validate", function enforceScope(next) {
  if (this.targetType === "general") {
    if (this.targetGroups && this.targetGroups.length > 0) {
      return next(
        new Error("targetGroups must be empty when targetType is 'general'.")
      );
    }
    if (this.targetStudents && this.targetStudents.length > 0) {
      return next(
        new Error("targetStudents must be empty when targetType is 'general'.")
      );
    }
  } else if (this.targetType === "group") {
    if (!this.targetGroups || this.targetGroups.length === 0) {
      return next(
        new Error(
          "targetGroups must be a non-empty array when targetType is 'group'."
        )
      );
    }
    if (this.targetStudents && this.targetStudents.length > 0) {
      return next(
        new Error(
          "targetStudents must be empty when targetType is 'group'."
        )
      );
    }
  } else if (this.targetType === "student") {
    if (!this.targetStudents || this.targetStudents.length === 0) {
      return next(
        new Error(
          "targetStudents must be a non-empty array when targetType is 'student'."
        )
      );
    }
    if (this.targetGroups && this.targetGroups.length > 0) {
      return next(
        new Error(
          "targetGroups must be empty when targetType is 'student'."
        )
      );
    }
  }
  return next();
});

// -------- Índices compuestos --------
// Patrón: "todos los avisos de este tipo en mi escuela" (lo más común
// para los listados de staff y para los contadores del dashboard).
announcementSchema.index(
  { school: 1, targetType: 1 },
  { name: "idx_school_targetType" }
);
// Patrón: "todos los avisos publicados en este ciclo escolar de mi escuela".
announcementSchema.index(
  { school: 1, schoolYear: 1 },
  { name: "idx_school_schoolYear" }
);
// Índice simple sobre expiresAt para acelerar el filtro de "no vencidos"
// en las queries de los tutores.
announcementSchema.index(
  { expiresAt: 1 },
  { name: "idx_expiresAt" }
);

const Announcement = model("Announcement", announcementSchema);
module.exports = Announcement;
