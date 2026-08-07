// Modelo de Registro de Asistencia
// Cada documento representa un evento de entrada o salida generado por un
// dispositivo. Pertenece a UNA escuela (tenant) — se desnormaliza desde
// el estudiante para acelerar consultas tenant-scoped.
const { Schema, model } = require("mongoose");

const attendanceLogSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — obligatoria para aislamiento multi-tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    student_id: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student reference is required."],
    },
    event_time: {
      type: Date,
      required: [true, "Event time is required."],
      default: Date.now, //el formato de fecha que se guarda en la base de datos es: 2024-06-05T19:00:00.000Z
    },
    event_type: {
      type: String,
      required: [true, "Event type is required."],
      enum: {
        values: ["entry", "exit"],
        message: "Event type must be: entry or exit.",
      },
    },
    device: {
      type: String,
      required: [true, "Device is required."],
      trim: true,
    },
    // Cómo se verificó la identidad del alumno en este evento:
    //   RFID   → lectura de tarjeta (default histórico: todos los logs
    //            previos a la autenticación híbrida provienen de lectores RFID)
    //   FACE   → reconocimiento facial en la terminal ZKTeco (match por PIN)
    //   MANUAL → alta capturada a mano por personal de la escuela
    verificationMode: {
      type: String,
      enum: {
        values: ["FACE", "RFID", "MANUAL"],
        message: "Verification mode must be one of: FACE, RFID, MANUAL.",
      },
      default: "RFID",
    },
    // Foto capturada por la cámara en el instante del check-in (opcional).
    // Es evidencia del evento, NO la foto de referencia del alumno
    // (esa vive en Student.photoUrl).
    snapshotUrl: {
      type: String,
      default: null,
      trim: true,
    },
    notification_sent: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

attendanceLogSchema.index({ student_id: 1, event_time: -1 });
attendanceLogSchema.index({ event_time: -1, event_type: 1 });
// Índice compuesto para el patrón de consulta más común: logs por escuela y fecha
attendanceLogSchema.index({ school: 1, event_time: -1 });

const AttendanceLog = model("AttendanceLog", attendanceLogSchema);

module.exports = AttendanceLog;
