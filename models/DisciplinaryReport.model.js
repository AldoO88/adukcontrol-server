// Modelo de Reporte Disciplinario
// Representa una amonestación o reporte de conducta asociado a un estudiante
// dentro de un ciclo escolar. Cada reporte descuenta puntos del "score de
// conducta" del alumno (configurable por escuela via ConductConfig).
//
// Regla multi-tenant: cada reporte pertenece a UNA escuela.
// El campo `points_deduction` se denormaliza al momento de crear el reporte
// para que los cambios futuros en la política de la escuela NO reescriban
// el historial (un reporte "severe" de 2024 sigue descontando lo que
// descontó en su momento, aunque la escuela baje el peso después).
const { Schema, model } = require("mongoose");

const disciplinaryReportSchema = new Schema(
  {
    // Referencia a la escuela (tenant)
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Estudiante reportado
    student_id: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student reference is required."],
      index: true,
    },
    // Ciclo escolar al que pertenece el reporte.
    // Permite que el score de conducta se "resetee" naturalmente entre ciclos
    // (los reportes viejos quedan en la colección pero no suman al año actual).
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
      index: true,
    },
    // Severidad del reporte. Cataloga el tipo de falta.
    severity: {
      type: String,
      required: [true, "Severity is required."],
      enum: {
        values: ["minor", "moderate", "severe"],
        message: "severity must be: minor, moderate or severe.",
      },
      index: true,
    },
    // Puntos a descontar al momento de crear el reporte. Se copia desde
    // ConductConfig para que el cálculo del score sea estable aunque
    // la escuela cambie su política más adelante.
    points_deduction: {
      type: Number,
      required: [true, "points_deduction is required."],
      min: [0, "points_deduction must be >= 0."],
    },
    // Descripción opcional del incidente (qué pasó)
    description: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
    },
    // Fecha en que ocurrió la incidencia. Puede diferir de createdAt
    // (ej. el prefecto asienta el lunes un reporte del viernes anterior).
    incident_date: {
      type: Date,
      required: [true, "incident_date is required."],
      default: Date.now,
    },
    // Usuario que registró el reporte (típicamente prefect, social_worker,
    // teacher, principal, admin o registrar).
    reported_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Reporter is required."],
    },
    // Soft-void: la dirección puede cancelar un reporte (capturado por error).
    // Los cancelados NO cuentan para el cálculo del score de conducta.
    status: {
      type: String,
      enum: {
        values: ["active", "cancelled"],
        message: "status must be: active or cancelled.",
      },
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Índice compuesto para el patrón más común:
// "todos los reportes ACTIVOS de este alumno en este ciclo, de esta escuela"
// Soporta directamente el $match del KPI #3 (conduct_score) en una sola pasada.
disciplinaryReportSchema.index(
  { school: 1, student_id: 1, school_year_id: 1, status: 1 },
  { name: "idx_school_student_year_status" }
);
// Listado general por escuela + fecha (cronológico inverso)
disciplinaryReportSchema.index({ school: 1, incident_date: -1 });

const DisciplinaryReport = model(
  "DisciplinaryReport",
  disciplinaryReportSchema
);

module.exports = DisciplinaryReport;
