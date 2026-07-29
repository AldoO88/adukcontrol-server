// Modelo de Usuario
// Define el esquema de los usuarios del sistema:
//   - Staff (super_admin, admin, principal, registrar, teacher, prefect, social_worker):
//     se loguean con email + password. Su escuela se fija al crearlos.
//   - Tutor (padre/madre/guardián): se pre-registra con phoneNumber y se activa
//     por SMS (OTP). Una vez activado, se loguea con phoneNumber + password.
// Regla multi-tenant: cada usuario pertenece a UNA escuela, salvo super_admin.
const { Schema, model } = require("mongoose"); // Constructores de Mongoose
const bcrypt = require("bcryptjs"); // Hashing de contraseñas y OTP

const userSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — obligatoria salvo para super_admin
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: function () {
        return this.role !== "super_admin";
      },
      index: true,
      default: null,
    },
    // Nombre a mostrar del usuario (primer nombre o nombre de pila)
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
    },
    // Apellido del usuario. Requerido salvo para super_admin (bootstrap
    // inicial del sistema). Usado por el dashboard del tutor para construir
    // el saludo "Hola, <name> <last_name>".
    last_name: {
      type: String,
      required: function () {
        return this.role !== "super_admin";
      },
      default: null,
      trim: true,
    },
    // Email del usuario (opcional). El login es por phoneNumber, pero el email
    // puede servir para notificaciones, recuperación u otros flujos futuros.
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        "Please provide a valid email address.",
      ],
    },
    // Número de celular a 10 dígitos (formato MX, sin código de país).
    // Identificador universal de login y de contacto para OTP.
    // Requerido para TODOS los roles.
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required."],
      match: [/^\d{10}$/, "Phone number must be 10 digits."],
      trim: true,
    },
    // Contraseña hasheada con bcrypt. Para tutor es null hasta que active la cuenta.
    password: {
      type: String,
      required: false,
      minlength: [8, "Password must be at least 8 characters long."],
      select: false,
    },
    // Rol de autorización
    role: {
      type: String,
      required: [true, "Role is required."],
      enum: {
        values: [
          "super_admin",    // Cross-tenant
          "admin",          // Administrador de su escuela
          "principal",      // Dirección escolar
          "registrar",      // Control escolar
          "teacher",        // Maestro
          "prefect",        // Prefecto
          "social_worker",  // Trabajo social
          "tutor",          // Padre/madre/guardián (cuenta separada, login por celular)
        ],
        message:
          "Role must be one of: super_admin, admin, principal, registrar, teacher, prefect, social_worker, tutor.",
      },
    },
    // Bandera de activación. Staff: true por defecto. Tutor: false hasta activar por OTP.
    isActive: {
      type: Boolean,
      default: function () {
        return this.role === "super_admin";
      },
    },
    // OTP temporal (hasheado con bcrypt). Solo presente durante el flujo de activación.
    // Nunca se devuelve en queries por defecto.
    otpCode: {
      type: String,
      select: false,
      default: null,
    },
    // Fecha de expiración del OTP. Típicamente now + 10 min.
    otpExpiresAt: {
      type: Date,
      select: false,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Email único por escuela (staff). Se excluyen tutores (email null) y super_admins (school null).
userSchema.index(
  { school: 1, email: 1 },
  {
    unique: true,
    name: "uniq_school_email",
    partialFilterExpression: {
      school: { $type: "objectId" },
      email: { $exists: true, $type: "string" },
    },
  }
);
// Email único para super_admins (school null)
userSchema.index(
  { email: 1 },
  {
    unique: true,
    name: "uniq_super_admin_email",
    partialFilterExpression: { school: null },
  }
);
// phoneNumber único por escuela (solo tutores tienen phoneNumber)
userSchema.index(
  { school: 1, phoneNumber: 1 },
  {
    unique: true,
    name: "uniq_school_phone",
    partialFilterExpression: { phoneNumber: { $type: "string" } },
  }
);
userSchema.index({ role: 1, isActive: 1 });

// Hook pre-save: hashea password o OTP si fueron modificados.
// Si password es null/empty (tutor no activado), no intenta hashear.
userSchema.pre("save", async function hashSecrets(next) {
  try {
    if (this.isModified("password") && this.password) {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(this.password, salt);
    }
    if (this.isModified("otpCode") && this.otpCode) {
      const salt = await bcrypt.genSalt(10);
      this.otpCode = await bcrypt.hash(this.otpCode, salt);
    }
    return next();
  } catch (error) {
    return next(error);
  }
});

// Compara una contraseña en texto plano contra el hash.
// Devuelve false si el usuario no tiene password (tutor no activado).
userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

// Compara un OTP en texto plano contra el hash almacenado.
userSchema.methods.compareOtp = function compareOtp(candidate) {
  if (!this.otpCode) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.otpCode);
};

const User = model("User", userSchema);

module.exports = User;
