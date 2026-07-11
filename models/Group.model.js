const { Schema, model } = require("mongoose"); // Constructores de Mongoose

const groupSchema = new Schema( // Esquema de Grupo
  {
    grado: { // Nivel/grado escolar
      type: Number, // Numérico
      required: [true, "Grado is required."], // Obligatorio
      enum: { // Solo 1, 2, 3
        values: [1, 2, 3],
        message: "Grado must be 1, 2 or 3.",
      },
    },
    grupo: { // Letra de sección
      type: String, // Cadena
      required: [true, "Grupo is required."], // Obligatorio
      trim: true, // Quitar espacios
      uppercase: true, // Normalizar a mayúsculas
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
    tutor_maestro_id: { // Maestro titular
      type: Schema.Types.ObjectId, // ObjectId
      ref: "User", // Colección relacionada
      default: null, // Sin asignar
    },
  },
  {
    timestamps: true, // createdAt + updatedAt
    versionKey: false, // Sin __v
  }
);

groupSchema.index( // Combinación única grado+grupo+ciclo
  { grado: 1, grupo: 1, ciclo_escolar: 1 },
  { unique: true, name: "uniq_grado_grupo_ciclo" }
);
groupSchema.index({ tutor_maestro_id: 1 }); // Búsqueda por maestro

const Group = model("Group", groupSchema); // Compilar modelo

module.exports = Group; // Exportar
