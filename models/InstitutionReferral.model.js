// =====================================================================
// InstitutionReferral.model.js
// ---------------------------------------------------------------------
// Referencias de alumnos a instituciones externas (hospitales,
// clínicas, psicólogos, terapeutas, etc.) gestionadas por el
// trabajador social.
//
// Cada referencia pertenece a una escuela (multi-tenant) y está
// asociada a un alumno específico. Registra el motivo, la
// institución de destino y el estado de la referancia.
// =====================================================================

const { Schema, model } = require("mongoose");

const institutionReferralSchema = new Schema(
  {
    // --- Tenant ---
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },

    // --- Alumno ---
    student_id: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student reference is required."],
      index: true,
    },

    // --- Institución ---
    institution_name: {
      type: String,
      required: [true, "Institution name is required."],
      trim: true,
      maxlength: 200,
    },
    institution_type: {
      type: String,
      enum: {
        values: ["hospital", "clinica", "psicologia", "terapia", "trabajo_social", "educacion_especial", "otro"],
        message: "institution_type must be: hospital, clinica, psicologia, terapia, trabajo_social, educacion_especial, otro.",
      },
      default: "otro",
    },
    contact_info: {
      type: String,
      trim: true,
      default: null,
    },

    // --- Referencia ---
    reason: {
      type: String,
      required: [true, "Reason is required."],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        values: ["pending", "sent", "in_progress", "completed", "cancelled"],
        message: "status must be: pending, sent, in_progress, completed, cancelled.",
      },
      default: "pending",
      index: true,
    },

    // --- Fechas ---
    referral_date: {
      type: Date,
      default: Date.now,
    },
    response_date: {
      type: Date,
      default: null,
    },
    response_notes: {
      type: String,
      trim: true,
      default: null,
    },

    // --- Creado por ---
    reported_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Reporter is required."],
    },
  },
  {
    timestamps: true,
  }
);

// Índices compuestos para queries comunes del trabajador social.
institutionReferralSchema.index({ school: 1, student_id: 1, status: 1 });
institutionReferralSchema.index({ school: 1, status: 1, referral_date: -1 });

const InstitutionReferral = model("InstitutionReferral", institutionReferralSchema);

module.exports = InstitutionReferral;
