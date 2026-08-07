// Modelo de ConductLog (antes DisciplinaryReport)
// Ledger de eventos de conducta de un estudiante. Soporta TANTO
// deméritos (conductas negativas que restan puntos) como méritos
// (conductas positivas que suman puntos y permiten recuperar el score).
//
// Regla multi-tenant: cada evento pertenece a UNA escuela.
// El campo `points_impact` es SIEMPRE positivo (magnitud). El controller
// es responsable de aplicar el signo correcto en la suma:
//   - demerit → score -= points_impact
//   - merit   → score += points_impact
// (Ver bloque "Lógica de agregación del KPI" más abajo).
//
// =====================================================================
// LÓGICA DE AGREGACIÓN DEL KPI DE CONDUCTA (para el controller)
// =====================================================================
// score = baseline                                (punto de partida)
// for each log activo del estudiante (cualquier año):
//   if eventType === "demerit" → score -= points_impact
//   if eventType === "merit"   → score += points_impact
// score = max(floor, min(baseline, score))        (clamp [floor, baseline])
//
// El score NUNCA baja de `floor` (default 0) ni sube de `baseline`
// (default 100), aunque el alumno acumule méritos extra. Los méritos
// solo permiten RECUPERAR puntos perdidos por deméritos, no superar
// el baseline.
//
// Aggregation equivalente en Mongoose:
//   ConductLog.aggregate([
//     { $match: { school, student_id, status: "active" } },
//     { $group: {
//       _id: null,
//       signedTotal: {
//         $sum: {
//           $cond: [
//             { $eq: ["$eventType", "merit"] },
//             "$points_impact",
//             { $multiply: ["$points_impact", -1] }  // demerit → negativo
//           ]
//         }
//       }
//     }},
//   ])
//
//   const total = result[0]?.signedTotal ?? 0;
//   const rawScore = config.baseline + total;
//   const score = Math.max(config.floor, Math.min(config.baseline, rawScore));
//
// =====================================================================
const { Schema, model } = require("mongoose");

const conductLogSchema = new Schema(
  {
    // -------- Tenant & aislamiento --------
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
      index: true,
    },
    // Ciclo escolar del evento. El KPI es ACUMULADO entre años, pero este
    // campo permite filtrar los eventos del ciclo actual para mostrarlos
    // en el dashboard del tutor.
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
      index: true,
    },

    // -------- Tipo de evento --------
    // "demerit" → falta disciplinaria (resta puntos).
    // "merit"   → acción positiva (suma puntos y permite recuperar score).
    eventType: {
      type: String,
      required: [true, "eventType is required."],
      enum: {
        values: ["demerit", "merit"],
        message: 'eventType must be: "demerit" or "merit".',
      },
      index: true,
    },

    // -------- Clasificación (opcional) --------
    // Para deméritos, severity cataloga la gravedad (minor/moderate/severe).
    // Para méritos, este campo es OPCIONAL: queda null salvo que la escuela
    // quiera clasificar méritos por alguna escala similar (en ese caso el
    // controller puede pasar el valor que quiera). Si se requiere una
    // taxonomía propia para méritos, agregar un campo `merit_category`
    // separado en lugar de reusar severity.
    severity: {
      type: String,
      required: false,
      default: null,
      enum: {
        values: ["minor", "moderate", "severe"],
        message: "severity must be: minor, moderate or severe.",
      },
    },

    // -------- Magnitud del impacto --------
    // SIEMPRE positivo. El controller aplica el signo según `eventType`
    // en el momento de crear el evento y al agregarlo para el KPI.
    // Min 0 para impedir valores negativos accidentales (sería un bug).
    points_impact: {
      type: Number,
      required: [true, "points_impact is required."],
      min: [0, "points_impact must be >= 0."],
    },

    // -------- Metadata --------
    // Título corto del evento (lo que se muestra como "encabezado" de la
    // card en la UI, ej: "Uso de celular", "Colaboración Proactiva").
    description: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
    },
    // Descripción larga y detallada del incidente. Opcional. El front la
    // muestra debajo del título en la card de "Historial de reportes".
    // Si llega a null, la UI simplemente no renderiza el segundo párrafo.
    details: {
      type: String,
      default: null,
      trim: true,
      maxlength: 2000,
    },
    // Fecha en que ocurrió el evento. Puede diferir de createdAt
    // (ej. el prefecto asienta el lunes un evento del viernes anterior).
    incident_date: {
      type: Date,
      required: [true, "incident_date is required."],
      default: Date.now,
    },
    // Usuario que registró el evento (staff con permisos).
    reported_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Reporter is required."],
    },
    // Soft-void: la dirección puede cancelar un evento (capturado por error).
    // Los cancelados NO cuentan para el cálculo del score.
    status: {
      type: String,
      required: [true, "status is required."],
      enum: {
        values: ["active", "cancelled"],
        message: 'status must be: "active" or "cancelled".',
      },
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// -------- Índices --------
// Patrón del KPI: "todos los eventos ACTIVOS de este alumno en este ciclo,
// de esta escuela" — soporta el $match de la aggregation del score.
conductLogSchema.index(
  { school: 1, student_id: 1, school_year_id: 1, status: 1 },
  { name: "idx_school_student_year_status" }
);
// Patrón UI: "todos los méritos de este alumno" o "todos los deméritos"
// (filtrar el ledger por tipo en la vista del tutor / staff).
conductLogSchema.index(
  { school: 1, student_id: 1, eventType: 1 },
  { name: "idx_school_student_eventType" }
);
// Listado general por escuela + fecha (cronológico inverso).
conductLogSchema.index(
  { school: 1, incident_date: -1 },
  { name: "idx_school_incident_date" }
);

const ConductLog = model("ConductLog", conductLogSchema);
module.exports = ConductLog;
