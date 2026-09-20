// =====================================================================
// ExitPass.model.js
// ---------------------------------------------------------------------
// Registro de pases de salida. Cada documento representa un retiro
// anticipado de un alumno, indicando quién lo recoge, el motivo y
// la fecha/hora de salida. Solo es un registro — no afecta el flujo
// de asistencia biométrica.
// =====================================================================

const { Schema, model } = require("mongoose");

const exitPassSchema = new Schema(
  {
    // Tenant scope — obligatorio para aislamiento multi-tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
    },
    student_id: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student reference is required."],
    },
    group_id: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: [true, "Group reference is required."],
    },
    // Datos de quien retira al alumno
    guardian_name: {
      type: String,
      required: [true, "Guardian name is required."],
      trim: true,
      maxlength: 200,
    },
    relationship: {
      type: String,
      required: [true, "Relationship is required."],
      enum: {
        values: ["father", "mother", "guardian", "family"],
        message: "Relationship must be: father, mother, guardian or family.",
      },
    },
    // Motivo del retiro
    reason: {
      type: String,
      required: [true, "Reason is required."],
      enum: {
        values: ["illness", "medical", "family", "personal", "other"],
        message:
          "Reason must be: illness, medical, family, personal or other.",
      },
    },
    reason_detail: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    // Fecha y hora de salida (cuando se crea el pase)
    exit_time: {
      type: Date,
      required: [true, "Exit time is required."],
      default: Date.now,
    },
    // Quién registró el pase (prefecto)
    created_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Creator reference is required."],
    },
    // Estado del pase de salida
    status: {
      type: String,
      enum: {
        values: ["active", "cancelled"],
        message: "Status must be: active or cancelled.",
      },
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Índices compuestos para consultas frecuentes
exitPassSchema.index({ school: 1, exit_time: -1 });
exitPassSchema.index({ student_id: 1, exit_time: -1 });

const ExitPass = model("ExitPass", exitPassSchema);

module.exports = ExitPass;
