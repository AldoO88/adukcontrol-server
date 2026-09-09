// Modelo de Cierre de Calificaciones (GradeClosing)
// Documento de workflow que marca un combo (grupo + materia + período) como
// "cerrado" para el maestro que cerró. Se distingue del `GradingPeriod.isClosed`
// (que es un flag global por período): aquí el cierre es por combo, así el
// maestro puede cerrar `1° A · Ofimática I · 1er Trim` independientemente de
// `3° OFIMÁTICA · Tecnología I · 1er Trim` (estados distintos en la UI).
//
// Regla multi-tenant: cada cierre pertenece a UNA escuela.
// Una sola fila por combo (índice único). Si en el futuro se reactiva el botón
// "Descargar Acta", este modelo es el lugar natural para agregar `actaUrl`.
const { Schema, model } = require("mongoose");

const gradeClosingSchema = new Schema(
  {
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
    },
    group_id: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: [true, "Group reference is required."],
    },
    subject_id: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: [true, "Subject reference is required."],
    },
    period_id: {
      type: Schema.Types.ObjectId,
      ref: "GradingPeriod",
      required: [true, "Grading period reference is required."],
    },
    teacher_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Teacher reference is required."],
    },
    closedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Una sola fila por combo (school_year_id + group + subject + period)
gradeClosingSchema.index(
  { school_year_id: 1, group_id: 1, subject_id: 1, period_id: 1 },
  { unique: true, name: "uniq_grade_closing_per_combo" }
);
// Query: "todos los cierres del maestro en un período" (usado por validation)
gradeClosingSchema.index(
  { school: 1, teacher_id: 1, period_id: 1 },
  { name: "idx_grade_closing_teacher_period" }
);

const GradeClosing = model("GradeClosing", gradeClosingSchema);

module.exports = GradeClosing;
