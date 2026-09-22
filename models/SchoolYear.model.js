// Modelo de Ciclo Escolar (SchoolYear)
// Representa un ciclo escolar concreto (e.g. "2025-2026") de UNA escuela
// (tenant). Reemplaza el campo suelto `school_year: String` que antes se
// repetía en Group, Enrollment, Grade, TeacherSubject y School — ahora
// esos modelos referencian este documento vía `school_year_id`.
const { Schema, model } = require("mongoose");

const schoolYearSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — cada escuela tiene sus propios ciclos.
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Nombre del ciclo, e.g. "2025-2026"
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
      match: [/^\d{4}-\d{4}$/, "name must follow the pattern YYYY-YYYY."],
    },
    startDate: {
      type: Date,
      required: [true, "startDate is required."],
    },
    endDate: {
      type: Date,
      required: [true, "endDate is required."],
    },
    // Días de la semana que son lectivos (0=Dom, 1=Lun, ..., 6=Sáb).
    // Default: Lunes a Viernes [1,2,3,4,5].
    workingDays: {
      type: [Number],
      default: [1, 2, 3, 4, 5],
      validate: {
        validator: (v) => v.every((d) => d >= 0 && d <= 6),
        message: "workingDays values must be between 0 (Sunday) and 6 (Saturday).",
      },
    },
    // Solo debe haber UN ciclo activo por escuela a la vez. La activación
    // se gestiona en el controller (activateSchoolYear), que desactiva los
    // demás ciclos de la misma escuela y sincroniza School.current_school_year_id.
    isActive: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Un mismo ciclo (nombre) no puede repetirse dentro de la misma escuela
schoolYearSchema.index(
  { school: 1, name: 1 },
  { unique: true, name: "uniq_school_year_name" }
);
schoolYearSchema.index({ school: 1, isActive: 1 });

const SchoolYear = model("SchoolYear", schoolYearSchema);

module.exports = SchoolYear;
