// Modelo de Período de Evaluación (GradingPeriod)
// Reemplaza al campo suelto `Grade.period: Number` (0|1|2|3) por un catálogo
// configurable POR ESCUELA y POR CICLO: unas escuelas evalúan por trimestres,
// otras por bimestres o pentamestres, y las fechas de corte cambian cada año.
//
// Ejemplo (secundaria mexicana, 3 trimestres + promedio final):
//   { name: "Trimestre 1", order: 1, startDate: 2026-08-24, endDate: 2026-11-27 }
//   { name: "Trimestre 2", order: 2, startDate: 2026-11-30, endDate: 2027-03-19 }
//   { name: "Trimestre 3", order: 3, startDate: 2027-03-22, endDate: 2027-07-15 }
//   { name: "Final",       order: 0, startDate: 2027-07-16, endDate: 2027-07-16 }
//
// CONVENCIÓN DE `order`: se conserva la semántica del campo `period` viejo —
// `order: 0` es la calificación FINAL del ciclo (no un período de captura
// normal) y 1..N son los períodos ordinarios en orden cronológico. La
// migración `scripts/migrate-grade-periods.js` depende de esta convención.
const { Schema, model } = require("mongoose");

const gradingPeriodSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — obligatoria para aislamiento multi-tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Ciclo escolar al que pertenece el período. Los períodos NO se heredan
    // entre ciclos: cada año se define su propio calendario de evaluación.
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
      index: true,
    },
    // Nombre visible: "Trimestre 1", "Bimestre 2", "Final"...
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
      maxlength: 60,
    },
    // Secuencia dentro del ciclo. 0 = calificación final, 1..N = ordinarios.
    // Es el campo por el que se ordenan los reportes y los promedios.
    order: {
      type: Number,
      required: [true, "Order is required."],
      min: [0, "order must be 0 (final) or a positive sequence number."],
    },
    startDate: {
      type: Date,
      required: [true, "startDate is required."],
    },
    endDate: {
      type: Date,
      required: [true, "endDate is required."],
    },
    // Cierre de captura: cuando es true el controller de Grade debe rechazar
    // altas y ediciones de notas de este período. El schema NO lo aplica —
    // es una bandera de negocio, no una restricción de integridad.
    isClosed: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Coherencia de fechas. Se valida a nivel schema porque un período invertido
// rompe silenciosamente la resolución "¿en qué período cae esta fecha?".
gradingPeriodSchema.pre("validate", function (next) {
  if (this.startDate && this.endDate && this.endDate < this.startDate) {
    this.invalidate("endDate", "endDate must be greater than or equal to startDate.");
  }
  next();
});

// Un mismo `order` no puede repetirse dentro del ciclo de una escuela.
gradingPeriodSchema.index(
  { school: 1, school_year_id: 1, order: 1 },
  { unique: true, name: "uniq_school_year_period_order" }
);
// Tampoco el nombre: evita "Trimestre 1" duplicado por captura doble.
gradingPeriodSchema.index(
  { school: 1, school_year_id: 1, name: 1 },
  { unique: true, name: "uniq_school_year_period_name" }
);
// Patrón "¿qué período está corriendo hoy?" — ver findByDate más abajo.
gradingPeriodSchema.index({ school: 1, school_year_id: 1, startDate: 1, endDate: 1 });

// Resuelve el período de evaluación que contiene una fecha dada.
// Excluye `order: 0` (el "final" no es un período de captura ordinario).
// Devuelve null si la fecha cae fuera de todos los períodos (vacaciones).
gradingPeriodSchema.statics.findByDate = function (school, schoolYearId, date) {
  return this.findOne({
    school,
    school_year_id: schoolYearId,
    order: { $gt: 0 },
    startDate: { $lte: date },
    endDate: { $gte: date },
  }).sort({ order: 1 });
};

const GradingPeriod = model("GradingPeriod", gradingPeriodSchema);

module.exports = GradingPeriod;
