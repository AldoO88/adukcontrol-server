// Modelo de Calendario Escolar (SchoolCalendar)
// Registra días festivos, vacaciones, suspensiones, días no lectivos y
// días con horario especial (`special_schedule`). El cronjob de auto-ausencias
// consulta este modelo para:
//   - saber si un día es lectivo antes de marcar faltas; y
//   - ajustar el cutoff de entrada y el chequeo de salida cuando el día
//     tiene horario especial (`special_entry_time` / `special_exit_time`).
const { Schema, model } = require("mongoose");

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TIME_MESSAGE = "Time must be in 24h HH:mm format (e.g. '07:30').";

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
        values: [
          "holiday",
          "vacation",
          "suspension",
          "non_lectivo",
          "special_schedule",
        ],
        message:
          "type must be: holiday (festivo), vacation (receso), suspension (clima/social), non_lectivo (fin de semana), or special_schedule (horario especial — día lectivo con horario modificado).",
      },
    },
    // Nombre descriptivo del día (opcional): "Día de muertos", "Vacaciones navidad"
    name: {
      type: String,
      trim: true,
      maxlength: 120,
      default: null,
    },
    // Horario especial (solo aplica cuando type === "special_schedule").
    // El día SIGUE SIENDO lectivo; el cronjob usa estos valores en lugar de
    // los del SchoolShift para calcular el cutoff de entrada y el chequeo de
    // salida. Si solo una de las dos está presente, la otra cae al default
    // del turno (`shift.startTime` o `shift.endTime` respectivamente).
    //   special_entry_time: nunca debe ser anterior a shift.startTime
    //     (los alumnos no se "citan" antes de la hora oficial de la escuela).
    //   special_exit_time:  nunca debe ser posterior a shift.endTime.
    special_entry_time: {
      type: String,
      default: null,
      trim: true,
      match: [TIME_PATTERN, TIME_MESSAGE],
    },
    special_exit_time: {
      type: String,
      default: null,
      trim: true,
      match: [TIME_PATTERN, TIME_MESSAGE],
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
