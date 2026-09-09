// Modelo de Calificación por Evaluación (EvaluationGrade)
// Almacena la calificación de un alumno en una evaluación específica.
// Cada documento es una celda de la tabla de calificaciones: alumno × evaluación.
//
// Se usa junto con EvaluationType (columna de evaluación) y GradeRule (regla de promedio).
// El promedio se calcula en el controller usando las EvaluationGrades + EvaluationTypes.
const { Schema, model } = require("mongoose");

const evaluationGradeSchema = new Schema(
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
    // Evaluación a la que pertenece esta calificación
    evaluation_type_id: {
      type: Schema.Types.ObjectId,
      ref: "EvaluationType",
      required: [true, "Evaluation type reference is required."],
      index: true,
    },
    // Inscripción del alumno (para mantener consistencia con el modelo Grade existente)
    enrollment_id: {
      type: Schema.Types.ObjectId,
      ref: "Enrollment",
      required: [true, "Enrollment reference is required."],
    },
    // Alumno (denormalizado para queries rápidas)
    student_id: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student reference is required."],
      index: true,
    },
    // Calificación numérica
    // Para type="normal": escala 0-10
    // Para type="extra": escala 0-maxPoints del EvaluationType
    value: {
      type: Number,
      min: [0, "Grade value cannot be negative."],
      required: [true, "Grade value is required."],
    },
    // Maestro que asignó la calificación
    teacher_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Teacher reference is required."],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Una calificación por alumno por evaluación
evaluationGradeSchema.index(
  { evaluation_type_id: 1, enrollment_id: 1 },
  { unique: true, name: "uniq_evaluation_grade_per_student" }
);

// Query: "calificaciones de un alumno en todas las evaluaciones"
evaluationGradeSchema.index(
  { student_id: 1, school_year_id: 1 },
  { name: "idx_evaluation_grade_student_year" }
);

const EvaluationGrade = model("EvaluationGrade", evaluationGradeSchema);

module.exports = EvaluationGrade;
