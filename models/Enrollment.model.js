// Modelo de Inscripción
// Relaciona a un estudiante con un grupo durante un ciclo escolar específico.
// Cada inscripción pertenece a UNA escuela (tenant).
const { Schema, model } = require("mongoose");

const enrollmentSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — obligatoria para aislamiento multi-tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
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
    school_year: {
      type: String,
      required: [true, "School year is required."],
      trim: true,
      match: [
        /^\d{4}-\d{4}$/,
        "School year must follow the pattern YYYY-YYYY.",
      ],
    },
    cycle_status: {
      type: String,
      enum: {
        values: ["enrolled", "withdrawn", "graduated", "transferred"],
        message:
          "Cycle status must be one of: enrolled, withdrawn, graduated, transferred.",
      },
      default: "enrolled",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Único DENTRO de la escuela: un estudiante solo tiene una inscripción por ciclo en su escuela
enrollmentSchema.index(
  { school: 1, student_id: 1, school_year: 1 },
  { unique: true, name: "uniq_school_student_school_year" }
);
enrollmentSchema.index({ group_id: 1, school_year: 1 });
enrollmentSchema.index({ student_id: 1, cycle_status: 1 });

const Enrollment = model("Enrollment", enrollmentSchema);

module.exports = Enrollment;
