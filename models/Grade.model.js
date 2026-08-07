// Modelo de Calificación
// Representa la nota numérica (0-10) de un student en una materia durante
// un período específico de un ciclo escolar. Vinculado a la Enrollment del
// año (lo que garantiza que la nota pertenece al ciclo correcto y a la
// escuela del tenant).
//
// BREAKING CHANGES (migrar los datos ANTES de desplegar, en este orden):
//   1. `period: Number` (0|1|2|3) → `gradingPeriod` (ref GradingPeriod) +
//      `period_order` (copia desnormalizada del orden).
//      → node scripts/migrate-grade-periods.js
//   2. `subject: String` → `subject_id` (ref Subject).
//      → node scripts/migrate-subjects-to-refs.js
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
    // Materia del catálogo de la escuela. Antes era un String libre, lo que
    // permitía que "Matemáticas", "matematicas" y "Mate" convivieran como
    // materias distintas y rompía los promedios por materia.
    subject_id: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: [true, "Subject reference is required."],
      index: true,
    },
    // Período de evaluación. Sustituye al viejo `period: Number` (0|1|2|3):
    // ahora el catálogo es configurable por escuela y por ciclo, así que una
    // escuela puede evaluar por trimestres y otra por bimestres.
    // Ver models/GradingPeriod.model.js.
    gradingPeriod: {
      type: Schema.Types.ObjectId,
      ref: "GradingPeriod",
      required: [true, "Grading period reference is required."],
      index: true,
    },
    // DESNORMALIZADO desde GradingPeriod.order (0 = final, 1..N = ordinarios).
    // Existe para poder ordenar y agrupar por período sin un $lookup en cada
    // consulta: los promedios "by_period" del dashboard son la ruta caliente.
    // Se escribe exclusivamente desde el controller al resolver el
    // gradingPeriod — si se reordenan los períodos de un ciclo hay que
    // recalcularlo (ver scripts/migrate-grade-periods.js).
    period_order: {
      type: Number,
      required: [true, "period_order is required."],
      min: [0, "period_order must be 0 (final) or a positive sequence number."],
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
// Una materia solo se califica UNA vez por (enrollment, subject_id,
// gradingPeriod) — no se duplica la nota de Matemáticas-trimestre-1 para el
// mismo alumno. Sustituye a `uniq_enrollment_subject_period`, que indexaba los
// campos `period` y `subject` ya eliminados. Mongoose crea los índices nuevos
// pero NUNCA borra los viejos: los dropean las migraciones.
gradeSchema.index(
  { enrollment_id: 1, subject_id: 1, gradingPeriod: 1 },
  { unique: true, name: "uniq_enrollment_subject_id_grading_period" }
);
// Búsquedas por materia dentro de una escuela
gradeSchema.index({ school: 1, subject_id: 1, school_year_id: 1 });
// Búsquedas por enrollment ("ver notas de un alumno"), ya ordenadas por
// período gracias al campo desnormalizado.
gradeSchema.index({ enrollment_id: 1, period_order: 1 });

const Grade = model("Grade", gradeSchema);

module.exports = Grade;
