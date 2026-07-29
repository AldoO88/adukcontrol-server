// Modelo de Configuración de Conducta (ConductConfig)
// Un único documento por escuela que define la política de descuentos
// aplicada a los Reportes Disciplinarios.
//
// Si una escuela nunca creó este documento, el servicio `conduct.service`
// usa los defaults: minor=5, moderate=10, severe=20, baseline=100, floor=0.
const { Schema, model } = require("mongoose");

const conductConfigSchema = new Schema(
  {
    // Tenant — un único doc por escuela
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      unique: true,
      index: true,
    },
    // Puntos que descuenta cada severidad al score del alumno.
    // Se copian al Reporte al momento de crearlo (no se recalculan).
    weights: {
      minor: { type: Number, default: 5, min: 0 },
      moderate: { type: Number, default: 10, min: 0 },
      severe: { type: Number, default: 20, min: 0 },
    },
    // Puntos con los que el alumno inicia el año (default 100).
    baseline: {
      type: Number,
      default: 100,
      min: 0,
    },
    // Piso del score: el puntaje NUNCA baja de este valor (default 0).
    floor: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const ConductConfig = model("ConductConfig", conductConfigSchema);
module.exports = ConductConfig;
