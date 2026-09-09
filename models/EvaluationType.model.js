// Modelo de Tipo de Evaluación (EvaluationType)
// Define una columna de evaluación en la tabla de calificaciones del maestro.
// Cada documento es una columna: "Examen Diagnóstico", "Tarea 1", "Punto Extra Uniformidad", etc.
//
// Pertenecen a un grupo+materia+período específicos, creados por el maestro.
// Se usa junto con EvaluationGrade (calificación por alumno) y GradeRule (regla de promedio).
const { Schema, model } = require("mongoose");

const evaluationTypeSchema = new Schema(
  {
    // Tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Ciclo escolar
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
    },
    // Grupo al que pertenece esta evaluación
    group_id: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: [true, "Group reference is required."],
    },
    // Materia
    subject_id: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: [true, "Subject reference is required."],
    },
    // Período de evaluación
    period_id: {
      type: Schema.Types.ObjectId,
      ref: "GradingPeriod",
      required: [true, "Grading period reference is required."],
    },
    // Maestro que creó la evaluación
    teacher_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Teacher reference is required."],
    },
    // Nombre completo de la evaluación: "Examen Diagnóstico", "Tarea 1"
    name: {
      type: String,
      required: [true, "Evaluation name is required."],
      trim: true,
      maxlength: [60, "Evaluation name cannot exceed 60 characters."],
    },
    // Abreviatura para la tabla (máx 4 caracteres): "EXAD", "T1", "UNIF"
    abbreviation: {
      type: String,
      required: [true, "Abbreviation is required."],
      trim: true,
      uppercase: true,
      maxlength: [4, "Abbreviation cannot exceed 4 characters."],
    },
    // Tipo de evaluación
    type: {
      type: String,
      enum: {
        values: ["normal", "extra"],
        message: "Type must be 'normal' or 'extra'.",
      },
      required: [true, "Evaluation type is required."],
    },
    // Porcentaje de peso (solo para type="normal"). Ej: 30 = 30%
    // null para type="extra"
    percentage: {
      type: Number,
      min: [0, "Percentage cannot be negative."],
      max: [100, "Percentage cannot exceed 100."],
      default: null,
    },
    // Puntos máximos del punto extra (solo para type="extra"). Ej: 1, 2, 5
    // null para type="normal"
    maxPoints: {
      type: Number,
      min: [0, "Max points cannot be negative."],
      default: null,
    },
    // Orden de visualización en la tabla (0, 1, 2, ...)
    order: {
      type: Number,
      min: [0, "Order cannot be negative."],
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Una abreviatura única por grupo+materia+período
evaluationTypeSchema.index(
  { school: 1, school_year_id: 1, group_id: 1, subject_id: 1, period_id: 1, abbreviation: 1 },
  { unique: true, name: "uniq_evaluation_type_abbr_per_class" }
);

// Query: "evaluaciones de una clase en un período"
evaluationTypeSchema.index(
  { school: 1, group_id: 1, subject_id: 1, period_id: 1, order: 1 },
  { name: "idx_evaluation_type_class_period" }
);

const EvaluationType = model("EvaluationType", evaluationTypeSchema);

module.exports = EvaluationType;
