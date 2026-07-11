const { Schema, model } = require("mongoose"); // Constructores de Mongoose

const attendanceLogSchema = new Schema( // Esquema de Registro de Asistencia
  {
    student_id: { // Referencia al estudiante
      type: Schema.Types.ObjectId, // ObjectId
      ref: "Student", // Colección relacionada
      required: [true, "Student reference is required."], // Obligatorio
    },
    fecha_hora: { // Momento del evento
      type: Date, // Fecha
      required: [true, "Fecha hora is required."], // Obligatorio
      default: Date.now, // Ahora si se omite
    },
    tipo: { // Tipo de evento
      type: String, // Cadena
      required: [true, "Tipo is required."], // Obligatorio
      enum: { // Solo entrada o salida
        values: ["entrada", "salida"],
        message: "Tipo must be: entrada or salida.",
      },
    },
    dispositivo: { // Dispositivo de origen
      type: String, // Cadena
      required: [true, "Dispositivo is required."], // Obligatorio
      trim: true, // Quitar espacios
    },
    notificacion_enviada: { // Bandera de envío FCM
      type: Boolean, // Booleano
      default: false, // No enviado aún
    },
  },
  {
    timestamps: true, // createdAt + updatedAt
    versionKey: false, // Sin __v
  }
);

attendanceLogSchema.index({ student_id: 1, fecha_hora: -1 }); // Historial por estudiante
attendanceLogSchema.index({ fecha_hora: -1, tipo: 1 }); // Búsquedas por fecha

const AttendanceLog = model("AttendanceLog", attendanceLogSchema); // Compilar modelo

module.exports = AttendanceLog; // Exportar
