// Modelo de Escuela (Tenant)
// Representa una escuela cliente del SaaS. En la arquitectura multi-tenant,
// cada escuela aísla sus propios datos: User, Student, AttendanceLog,
// Enrollment, Group, etc. pertenecen a una sola escuela.
// Regla de oro: ninguna consulta debe devolver datos de otra escuela.
const { Schema, model } = require("mongoose");

const schoolSchema = new Schema(
  {
    // Nombre comercial u oficial de la escuela
    name: {
      type: String,
      required: [true, "School name is required."],
      trim: true,
    },
    // URL pública del logotipo (opcional; null hasta que se suba).
    // Se actualiza vía POST /api/schools/:schoolId/logo.
    logoUrl: {
      type: String,
      default: null,
      trim: true,
    },
    // Clave de Centro de Trabajo (CCT) — identificador oficial ante la SEP.
    // Único en todo el sistema, sin importar la escuela.
    cct: {
      type: String,
      required: [true, "CCT is required."],
      unique: true, // Garantiza unicidad global de la CCT
      trim: true,
      uppercase: true, // Normalizar a mayúsculas
    },
    // Bandera de activación: permite dar de baja lógica sin eliminar el tenant
    isActive: {
      type: Boolean,
      default: true,
    },
    // Ciclo escolar actual de la escuela (referencia a SchoolYear). Se
    // sincroniza automáticamente vía POST /api/school-years/:id/activate.
    // El dashboard y los listados usan este campo para saber "qué año corre
    // ahora" sin tener que consultar SchoolYear por isActive.
    current_school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// cct ya cuenta con índice por unique:true.
// Agregamos índice por isActive para filtrar escuelas activas rápidamente.
schoolSchema.index({ isActive: 1 });

const School = model("School", schoolSchema);

module.exports = School;
