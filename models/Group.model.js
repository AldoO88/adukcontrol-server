// Modelo de Grupo/Grado
// Representa una sección/clase de un grado específico en un ciclo escolar.
// Cada grupo pertenece a UNA escuela (tenant).
const { Schema, model } = require("mongoose");

const groupSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — obligatoria para aislamiento multi-tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    grade: {
      type: Number,
      required: [true, "Grade is required."],
      enum: {
        values: [1, 2, 3],
        message: "Grade must be 1, 2 or 3.",
      },
    },
    section: {
      type: String,
      required: [true, "Section is required."],
      trim: true,
      uppercase: true,
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
    head_teacher_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Único DENTRO de la escuela: mismo grado+sección+ciclo puede existir en otra escuela
groupSchema.index(
  { school: 1, grade: 1, section: 1, school_year: 1 },
  { unique: true, name: "uniq_school_grade_section_year" }
);
groupSchema.index({ head_teacher_id: 1 });

const Group = model("Group", groupSchema);

module.exports = Group;
