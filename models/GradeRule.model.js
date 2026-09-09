// Modelo de Regla de Calificación (GradeRule)
// Almacena la configuración de cómo se calcula el promedio para un grupo+materia+período.
//
// Dos modos:
//   - "simple": Todas las evaluaciones normales valen lo mismo (suma de notas ÷ cantidad)
//   - "weighted": Cada evaluación tiene un porcentaje específico (la suma debe dar 100%)
//
// Los Puntos Extra siempre se suman directamente al promedio calculado.
const { Schema, model } = require("mongoose");

const gradeRuleSchema = new Schema(
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
    // Grupo
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
    // Maestro que configuró la regla
    teacher_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Teacher reference is required."],
    },
    // Modo de cálculo del promedio
    averagingRule: {
      type: String,
      enum: {
        values: ["simple", "weighted"],
        message: "Averaging rule must be 'simple' or 'weighted'.",
      },
      default: "simple",
      required: [true, "Averaging rule is required."],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Una regla por grupo+materia+período+maestro
gradeRuleSchema.index(
  { school: 1, school_year_id: 1, group_id: 1, subject_id: 1, period_id: 1, teacher_id: 1 },
  { unique: true, name: "uniq_grade_rule_per_class_teacher" }
);

const GradeRule = model("GradeRule", gradeRuleSchema);

module.exports = GradeRule;
