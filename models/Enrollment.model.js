const { Schema, model } = require("mongoose"); // Constructores de Mongoose

const enrollmentSchema = new Schema( // Esquema de Inscripción
  {
    student_id: { // Referencia al estudiante
      type: Schema.Types.ObjectId, // ObjectId
      ref: "Student", // Colección relacionada
      required: [true, "Student reference is required."], // Obligatorio
    },
    group_id: { // Referencia al grupo
      type: Schema.Types.ObjectId, // ObjectId
      ref: "Group", // Colección relacionada
      required: [true, "Group reference is required."], // Obligatorio
    },
    ciclo_escolar: { // Ciclo escolar
      type: String, // Cadena
      required: [true, "Ciclo escolar is required."], // Obligatorio
      trim: true, // Quitar espacios
      match: [ // Formato YYYY-YYYY
        /^\d{4}-\d{4}$/,
        "Ciclo escolar must follow the pattern YYYY-YYYY.",
      ],
    },
    estatus_ciclo: { // Estado del ciclo
      type: String, // Cadena
      enum: { // Valores permitidos
        values: ["inscrito", "baja", "egresado", "trasladado"],
        message:
          "Estatus ciclo must be: inscrito, baja, egresado or trasladado.",
      },
      default: "inscrito", // Estado por defecto
    },
  },
  {
    timestamps: true, // createdAt + updatedAt
    versionKey: false, // Sin __v
  }
);

enrollmentSchema.index( // Una inscripción por estudiante y ciclo
  { student_id: 1, ciclo_escolar: 1 },
  { unique: true, name: "uniq_student_ciclo" }
);
enrollmentSchema.index({ group_id: 1, ciclo_escolar: 1 }); // Búsquedas por grupo
enrollmentSchema.index({ student_id: 1, estatus_ciclo: 1 }); // Historial del estudiante

const Enrollment = model("Enrollment", enrollmentSchema); // Compilar modelo

module.exports = Enrollment; // Exportar
