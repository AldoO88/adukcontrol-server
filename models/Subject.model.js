// Modelo de Materia (Subject)
// Catálogo de materias que ofrece una escuela. Es la ÚNICA fuente de verdad
// del nombre de una materia: `Grade.subject_id`, `TeacherSubject.subject_id` y
// `ClassSchedule.subject_id` apuntan todos aquí.
//
// Antes las materias se guardaban como String libre en Grade.subject y
// TeacherSubject.subject, lo que permitía que "Matemáticas", "matematicas" y
// "Mate" convivieran como materias distintas y rompía los promedios por
// materia. Migrado con scripts/migrate-subjects-to-refs.js.
const { Schema, model } = require("mongoose");

const subjectSchema = new Schema(
  {
    // Tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Código corto de la materia (e.g., "MAT-101", "ESP-101")
    code: {
      type: String,
      required: [true, "Subject code is required."],
      trim: true,
      uppercase: true,
      maxlength: 20,
    },
    // Nombre completo (e.g., "Matemáticas I", "Español")
    name: {
      type: String,
      required: [true, "Subject name is required."],
      trim: true,
      maxlength: 100,
    },
    // Grado típico en que se imparte (1, 2 o 3). Opcional — una materia
    // puede impartirse en varios grados (lo 결정 el TeacherSubject).
    grade: {
      type: Number,
      enum: {
        values: [1, 2, 3],
        message: "grade must be 1, 2 or 3.",
      },
      default: null,
    },
    // Descripción opcional
    description: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
    // Si está activa o no (para "soft delete" de materias obsoletas)
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Código único DENTRO de la escuela
subjectSchema.index(
  { school: 1, code: 1 },
  { unique: true, name: "uniq_school_subject_code" }
);
// Búsqueda por nombre dentro de la escuela. NO es unique a propósito: los
// datos existentes pueden traer nombres repetidos y un unique reventaría la
// migración. Deduplicar el catálogo es una tarea aparte, manual.
subjectSchema.index({ school: 1, name: 1 }, { name: "idx_school_subject_name" });

const Subject = model("Subject", subjectSchema);

module.exports = Subject;
