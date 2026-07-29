// Modelo de Estudiante
// Representa a un alumno inscrito en la escuela. Almacena datos personales,
// la tarjeta RFID, y la referencia a sus tutores/guardianes (modelo propio,
// ver Guardian.model.js). Cada estudiante pertenece a UNA escuela (tenant).
const { Schema, model } = require("mongoose");

const studentSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — obligatoria para aislamiento multi-tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Matrícula o número de control; único DENTRO de la escuela
    enrollment_number: {
      type: String,
      required: [true, "Enrollment number is required."],
      trim: true,
      uppercase: true,
    },
    first_name: {
      type: String,
      required: [true, "First name is required."],
      trim: true,
    },
    last_name: {
      type: String,
      required: [true, "Last name is required."],
      trim: true,
    },
    // UID de la tarjeta RFID; único DENTRO de la escuela (opcional)
    rfid_card: {
      type: String,
      trim: true,
      uppercase: true,
    },
    // URL pública de la foto del estudiante (almacenada en Cloudinary).
    // Se actualiza vía POST /api/students/:studentId/photo.
    photoUrl: {
      type: String,
      default: null,
      trim: true,
    },
    // Referencias a los tutores/guardianes (ver Guardian.model.js).
    // Reemplaza al subdoc embebido que existía antes.
    guardians: {
      type: [Schema.Types.ObjectId],
      ref: "Guardian",
      default: [],
    },
    current_group_id: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: ["active", "withdrawn_temp", "withdrawn_permanent"],
        message:
          "Status must be one of: active, withdrawn_temp, withdrawn_permanent.",
      },
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Índices únicos por escuela (reemplazan los uniques globales previos)
studentSchema.index(
  { school: 1, enrollment_number: 1 },
  { unique: true, name: "uniq_school_enrollment_number" }
);
studentSchema.index(
  { school: 1, rfid_card: 1 },
  {
    unique: true,
    name: "uniq_school_rfid_card",
    partialFilterExpression: { rfid_card: { $type: "string" } },
  }
);

studentSchema.index({ current_group_id: 1 });
studentSchema.index({ last_name: 1, first_name: 1 });
studentSchema.index({ guardians: 1 });
// Nota: el índice de fcm_token ahora vive en Guardian.model.js sobre guardian.fcm_token

const Student = model("Student", studentSchema);

module.exports = Student;
