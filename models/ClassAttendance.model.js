// Modelo de Asistencia de Clase (ClassAttendance)
// Registra el pase de lista manual realizado por un maestro para una clase
// específica. Cada documento equivale a una sesión de clase: grupo + materia +
// fecha. El array `records` contiene el estado de cada alumno.
//
// Diferencia con AttendanceLog:
//   - AttendanceLog registra eventos individuales de entrada/salida (RFID/facial).
//   - ClassAttendance registra el pase de lista completo de una sesión de clase.
const { Schema, model } = require("mongoose");

const attendanceRecordSchema = new Schema(
  {
    student_id: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student reference is required."],
    },
    status: {
      type: String,
      required: [true, "Status is required."],
      enum: {
        values: ["present", "retard", "absent", "justified"],
        message: "Status must be one of: present, retard, absent, justified.",
      },
    },
    // Ubicación del alumno: está en la escuela o no
    // Útil cuando el alumno falta pero el maestro sabe que está en la escuela
    // (en enfermería, prefectura, dirección, etc.)
    location: {
      type: String,
      enum: {
        values: ["in_school", "absent"],
        message: "Location must be: in_school or absent.",
      },
      default: "absent",
    },
    // Nota opcional del maestro para este alumno
    note: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },
  },
  {
    _id: false,
    versionKey: false,
  }
);

const classAttendanceSchema = new Schema(
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
      index: true,
    },
    // Grupo
    group_id: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: [true, "Group reference is required."],
      index: true,
    },
    // Materia
    subject_id: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: [true, "Subject reference is required."],
    },
    // Maestro que tomó la lista
    teacher_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Teacher reference is required."],
      index: true,
    },
    // Referencia al ClassSchedule (horario) de esta sesión
    class_schedule_id: {
      type: Schema.Types.ObjectId,
      ref: "ClassSchedule",
      default: null,
    },
    // Período de evaluación al que pertenece esta sesión
    period_id: {
      type: Schema.Types.ObjectId,
      ref: "GradingPeriod",
      default: null,
      index: true,
    },
    // Fecha de la clase (solo fecha, sin hora)
    date: {
      type: Date,
      required: [true, "Date is required."],
    },
    // Hora de inicio de la clase (HH:mm)
    startTime: {
      type: String,
      trim: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be in HH:mm format."],
    },
    // Hora de fin de la clase (HH:mm)
    endTime: {
      type: String,
      trim: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "Time must be in HH:mm format."],
    },
    // Registros de asistencia por alumno
    records: {
      type: [attendanceRecordSchema],
      default: [],
    },
    // Resumen automático
    summary: {
      total: { type: Number, default: 0 },
      present: { type: Number, default: 0 },
      retard: { type: Number, default: 0 },
      absent: { type: Number, default: 0 },
      justified: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Un maestro solo puede pasar lista UNA vez por clase por día
classAttendanceSchema.index(
  { school: 1, school_year_id: 1, group_id: 1, subject_id: 1, teacher_id: 1, date: 1 },
  { unique: true, name: "uniq_class_attendance_per_session" }
);

// Consultas: "asistencia de un grupo en un día"
classAttendanceSchema.index({ school: 1, group_id: 1, date: -1 });
// Consultas: "asistencia de un alumno"
classAttendanceSchema.index({ "records.student_id": 1, date: -1 });

const ClassAttendance = model("ClassAttendance", classAttendanceSchema);

module.exports = ClassAttendance;
