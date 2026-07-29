// Modelo de Materia (Subject)
// Catálogo de materias que ofrece una escuela. Usado para tipar las
// calificaciones y asignar maestros a grupos específicos.
//
// Las "materias" se almacenan como string libre en Grade.subject por
// compatibilidad con datos existentes. Este modelo es el catálogo oficial:
// si una materia existe acá, su nombre es el "canónico" (y los maestros
// solo pueden calificar materias que tienen un TeacherSubject asignado).
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

const Subject = model("Subject", subjectSchema);

module.exports = Subject;
