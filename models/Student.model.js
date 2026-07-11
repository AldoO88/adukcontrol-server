const { Schema, model } = require("mongoose"); // Constructores de Mongoose

const tutorSchema = new Schema( // Subdocumento: tutor/tutela
  {
    name: { // Nombre del tutor
      type: String, // Cadena
      required: [true, "Tutor name is required."], // Obligatorio
      trim: true, // Quitar espacios
    },
    parentesco: { // Relación/parentesco
      type: String, // Cadena
      required: [true, "Parentesco is required."], // Obligatorio
      trim: true, // Quitar espacios
    },
    telefono: { // Número de teléfono
      type: String, // Cadena
      required: [true, "Tutor telefono is required."], // Obligatorio
      trim: true, // Quitar espacios
    },
    fcmToken: { // Token FCM del dispositivo
      type: String, // Cadena
      default: null, // Nulo hasta que se registre
      trim: true, // Quitar espacios
    },
  },
  { _id: false } // Sin _id en subdocumento
);

const studentSchema = new Schema( // Esquema de Estudiante
  {
    matricula: { // Identificador escolar
      type: String, // Cadena
      required: [true, "Matricula is required."], // Obligatorio
      unique: true, // Sin duplicados
      trim: true, // Quitar espacios
      uppercase: true, // Normalizar a mayúsculas
    },
    name: { // Nombre
      type: String, // Cadena
      required: [true, "Student name is required."], // Obligatorio
      trim: true, // Quitar espacios
    },
    apellidos: { // Apellidos
      type: String, // Cadena
      required: [true, "Apellidos are required."], // Obligatorio
      trim: true, // Quitar espacios
    },
    tarjeta_rfid: { // Tag RFID
      type: String, // Cadena
      unique: true, // Sin duplicados
      sparse: true, // Permitir ausentes
      trim: true, // Quitar espacios
      uppercase: true, // Normalizar a mayúsculas
    },
    tutores: { // Lista de tutores
      type: [tutorSchema], // Arreglo de sub-esquemas
      default: [], // Vacío por defecto
    },
    current_group_id: { // Referencia al grupo
      type: Schema.Types.ObjectId, // ObjectId
      ref: "Group", // Colección relacionada
      default: null, // Sin asignar
    },
    status: { // Estado del estudiante
      type: String, // Cadena
      enum: { // Valores permitidos
        values: ["activo", "baja_temporal", "baja_definitiva"],
        message:
          "Status must be: activo, baja_temporal or baja_definitiva.",
      },
      default: "activo", // Estado por defecto
    },
  },
  {
    timestamps: true, // createdAt + updatedAt
    versionKey: false, // Sin __v
  }
);

studentSchema.index({ matricula: 1 }); // Búsqueda por matrícula
studentSchema.index({ tarjeta_rfid: 1 }, { unique: true, sparse: true }); // Búsqueda por RFID
studentSchema.index({ current_group_id: 1 }); // Filtro por grupo
studentSchema.index({ apellidos: 1, name: 1 }); // Orden por nombre
studentSchema.index({ "tutores.fcmToken": 1 }); // Búsqueda por token FCM

const Student = model("Student", studentSchema); // Compilar modelo

module.exports = Student; // Exportar
