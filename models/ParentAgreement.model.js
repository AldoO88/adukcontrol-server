// =====================================================================
// ParentAgreement.model.js
// ---------------------------------------------------------------------
// Acuerdos entre el trabajador social y los padres/tutores respecto
// a la conducta, salud o situación académica de un alumno.
//
// Cada acuerdo pertenece a una escuela (multi-tenant) y está
// asociado a un alumno específico. Puede tener un tutor/guardian
// asociado (el padre con quien se firmó el acuerdo).
// =====================================================================

const { Schema, model } = require("mongoose");

const parentAgreementSchema = new Schema(
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

    // --- Tutor (opcional, el padre con quien se acordó) ---
    guardian_id: {
      type: Schema.Types.ObjectId,
      ref: "Guardian",
      default: null,
    },

    // --- Contenido del acuerdo ---
    title: {
      type: String,
      required: [true, "Title is required."],
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    agreement_type: {
      type: String,
      enum: {
        values: ["conducta", "academico", "salud", "inclusion", "otro"],
        message: "agreement_type must be: conducta, academico, salud, inclusion, otro.",
      },
      default: "conducta",
    },

    // --- Estado ---
    status: {
      type: String,
      enum: {
        values: ["active", "completed", "cancelled"],
        message: "status must be: active, completed, cancelled.",
      },
      default: "active",
      index: true,
    },

    // --- Fechas ---
    agreed_date: {
      type: Date,
      default: Date.now,
    },
    review_date: {
      type: Date,
      default: null,
    },

    // --- Participantes ---
    participants: [
      {
        name: { type: String, trim: true },
        role: { type: String, trim: true },
      },
    ],

    // --- Notas ---
    notes: {
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
parentAgreementSchema.index({ school: 1, student_id: 1, status: 1 });
parentAgreementSchema.index({ school: 1, status: 1, agreed_date: -1 });

const ParentAgreement = model("ParentAgreement", parentAgreementSchema);

module.exports = ParentAgreement;
