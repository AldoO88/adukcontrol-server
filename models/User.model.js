const { Schema, model } = require("mongoose"); // Constructores de Mongoose
const bcrypt = require("bcryptjs"); // Hashing de contraseñas

const userSchema = new Schema( // Esquema de Usuario
  {
    name: { // Nombre a mostrar
      type: String, // Cadena
      required: [true, "Name is required."], // Obligatorio
      trim: true, // Quitar espacios
    },
    email: { // Correo de acceso
      type: String, // Cadena
      required: [true, "Email is required."], // Obligatorio
      unique: true, // Sin duplicados
      lowercase: true, // Normalizar a minúsculas
      trim: true, // Quitar espacios
      match: [ // Regex estilo RFC
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        "Please provide a valid email address.",
      ],
    },
    password: { // Contraseña hasheada
      type: String, // Cadena
      required: [true, "Password is required."], // Obligatorio
      minlength: [8, "Password must be at least 8 characters long."], // Longitud mínima
      select: false, // Excluir de find por defecto
    },
    role: { // Rol de autorización
      type: String, // Cadena
      required: [true, "Role is required."], // Obligatorio
      enum: { // Valores permitidos
        values: ["admin", "control_escolar", "maestro", "prefecto"],
        message:
          "Role must be one of: admin, control_escolar, maestro, prefecto.",
      },
    },
    active: { // Bandera de desactivación
      type: Boolean, // Booleano
      default: true, // Activo por defecto
    },
  },
  {
    timestamps: true, // createdAt + updatedAt
    versionKey: false, // Sin __v
  }
);

userSchema.index({ email: 1 }); // Índice para búsqueda por email
userSchema.index({ role: 1, active: 1 }); // Índice compuesto rol+activo

userSchema.pre("save", async function hashPassword(next) { // Hook pre-save
  if (!this.isModified("password")) { // Saltar si no se modificó
    return next(); // Continuar
  }
  try {
    const salt = await bcrypt.genSalt(12); // Generar sal fuerte
    this.password = await bcrypt.hash(this.password, salt); // Hashear
    return next(); // Continuar guardado
  } catch (error) {
    return next(error); // Propagar error
  }
});

userSchema.methods.comparePassword = function comparePassword(candidate) { // Método de instancia
  return bcrypt.compare(candidate, this.password); // Comparación en tiempo constante
};

const User = model("User", userSchema); // Compilar modelo

module.exports = User; // Exportar
