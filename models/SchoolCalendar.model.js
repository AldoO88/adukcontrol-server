// Modelo de Calendario Escolar (SchoolCalendar)
// Registra días festivos, vacaciones, suspensiones y días no lectivos.
// El cronjob de auto-ausencias consulta este modelo para saber si un día
// es lectivo antes de marcar faltas.
const { Schema, model } = require("mongoose");

const schoolCalendarSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — obligatoria para aislamiento multi-tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Ciclo escolar al que pertenece el registro
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
      index: true,
    },
    // Fecha del día (solo fecha, sin hora). Un día solo tiene un registro
    // por escuela/ciclo (si hay múltiples razones, se usa el type principal).
    date: {
      type: Date,
      required: [true, "Date is required."],
    },
    // Tipo de día no lectivo
    type: {
      type: String,
      required: [true, "Type is required."],
      enum: {
        values: ["holiday", "vacation", "suspension", "non_lectivo"],
        message:
          "type must be: holiday (festivo), vacation (receso), suspension (clima/social), or non_lectivo (fin de semana).",
      },
    },
    // Nombre descriptivo del día (opcional): "Día de muertos", "Vacaciones navidad"
    name: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },
    // Soft delete
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Un día solo tiene un registro por escuela/ciclo
schoolCalendarSchema.index(
  { school: 1, school_year_id: 1, date: 1 },
  { unique: true, name: "uniq_school_year_date" }
);
// Queries del cronjob: "¿este día es festivo?"
schoolCalendarSchema.index(
  { school: 1, school_year_id: 1, date: 1, type: 1, is_active: 1 }
);

const SchoolCalendar = model("SchoolCalendar", schoolCalendarSchema);

module.exports = SchoolCalendar;
