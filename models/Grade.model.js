// Modelo de Calificación
// Representa la nota numérica (0-10) de un student en una materia durante
// un período específico de un ciclo escolar. Vinculado a la Enrollment del
// año (lo que garantiza que la nota pertenece al ciclo correcto y a la
// escuela del tenant).
const { Schema, model } = require("mongoose");

const gradeSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — para queries multi-tenant rápidos
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Inscripción del año al que pertenece esta nota. Garantiza:
    //  - La nota es del ciclo correcto (school_year de la Enrollment)
    //  - El student pertenece a la escuela (multi-tenant)
    //  - El group es consistente con el ciclo
    enrollment_id: {
      type: Schema.Types.ObjectId,
      ref: "Enrollment",
      required: [true, "Enrollment reference is required."],
      index: true,
    },
    // Ciclo escolar (denormalizado desde Enrollment para queries rápidas).
    // Se popula automáticamente al crear a partir de la Enrollment.
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
      index: true,
    },
    // Materia (string libre por ahora; futuro: modelo Subject separado)
    subject: {
      type: String,
      required: [true, "Subject is required."],
      trim: true,
    },
    // Período/trimestre: 1, 2, 3. 0 = calificación final del año.
    period: {
      type: Number,
      required: [true, "Period is required."],
      enum: {
        values: [0, 1, 2, 3],
        message: "period must be 0 (final), 1, 2 or 3.",
      },
      default: 1,
    },
    // Calificación numérica (escala 0-10, sistema educativo mexicano)
    value: {
      type: Number,
      required: [true, "Value is required."],
      min: [0, "Value must be at least 0."],
      max: [10, "Value must be at most 10."],
    },
    // Comentarios opcionales del maestro
    comments: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
    },
    // Quién puso la nota (típicamente un maestro)
    graded_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Cuándo se puso la nota (puede diferir de createdAt si se importa histórico)
    graded_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Índices
// Una materia solo se califica UNA vez por (enrollment, subject, period)
// (no se duplica la nota de Matemáticas-trimestre-1 para el mismo alumno)
gradeSchema.index(
  { enrollment_id: 1, subject: 1, period: 1 },
  { unique: true, name: "uniq_enrollment_subject_period" }
);
// Búsquedas por materia dentro de una escuela
gradeSchema.index({ school: 1, subject: 1, school_year_id: 1 });
// Búsquedas por enrollment (para "ver notas de un alumno")
gradeSchema.index({ enrollment_id: 1, period: 1 });

const Grade = model("Grade", gradeSchema);

module.exports = Grade;
