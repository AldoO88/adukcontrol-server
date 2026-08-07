// Modelo de Configuración de Conducta (ConductConfig)
// Un único documento por escuela que define la política de impacto de
// eventos de conducta (deméritos y méritos).
//
// Si la escuela nunca creó este documento, el servicio `conduct.service`
// usa los defaults:
//   - demerits:  minor=5,  moderate=10, severe=20
//   - merits:    merit_points=5
//   - baseline:  100  (punto de partida, también actúa como techo)
//   - floor:     0    (mínimo, el score nunca baja de acá)
//
// Reglas del score (ver bloque de comentarios en ConductLog.model.js):
//   score = clamp(baseline + (méritos - deméritos), floor, baseline)
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

    // Pesos de deméritos (restan puntos). Se copian al ConductLog al
    // momento de crearlo (no se recalculan contra cambios futuros).
    weights: {
      minor: { type: Number, default: 5, min: 1, max: 5 },
      moderate: { type: Number, default: 9, min: 5, max: 9 },
      severe: { type: Number, default: 18, min: 10, max: 18 },
    },

    // Valor por defecto de un mérito (suma puntos). El controller puede
    // aceptar un override en el body al crear un ConductLog de tipo merit
    // (ej. "Mérito liderazgo" puede valer 10 aunque el default sea 5).
    merit_points: {
      type: Number,
      default: 5,
      min: 0,
    },

    // Puntos con los que el alumno inicia el año (default 100).
    // También actúa como TECHO del score: un alumno nunca puede superar
    // este valor aunque acumule méritos extra.
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
