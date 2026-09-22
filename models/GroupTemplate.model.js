// Modelo de Plantilla de Grupo
// Catálogo de grupos a nivel escuela (sin ciclo escolar).
// Se usa como fuente para clonar Groups al crear un SchoolYear.

const { Schema, model } = require("mongoose");

const groupTemplateSchema = new Schema(
  {
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
    shift: {
      type: String,
      required: [true, "Shift is required."],
      enum: {
        values: ["matutino", "vespertino"],
        message: "shift must be: matutino or vespertino",
      },
      default: "matutino",
    },
    type: {
      type: String,
      enum: {
        values: ["regular", "taller"],
        message: "type must be: regular or taller",
      },
      default: "regular",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Índice único: mismo grado+sección no puede repetirse dentro de la escuela
groupTemplateSchema.index(
  { school: 1, grade: 1, section: 1 },
  { unique: true, name: "uniq_school_grade_section_template" }
);

const GroupTemplate = model("GroupTemplate", groupTemplateSchema);

module.exports = GroupTemplate;
