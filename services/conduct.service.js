// Servicio de Conducta
// Resuelve la configuración de impacto de eventos de conducta para cada
// escuela y aplica el signo (positivo/negativo) según el tipo de evento.
//
// Regla de negocio del score:
//   score = clamp(baseline + (méritos - deméritos), floor, baseline)
//   - baseline  → punto de partida y techo (el score nunca lo supera)
//   - floor     → piso (el score nunca baja de acá)
//
// El `points_impact` se congela al crear el evento (no se recalcula contra
// cambios futuros en la config), por lo que cambios en `weights` o
// `merit_points` NO afectan eventos ya creados.
const ConductConfig = require("../models/ConductConfig.model");

// Defaults cuando la escuela no tiene ConductConfig.
const DEFAULT_CONDUCT = {
  weights: { minor: 5, moderate: 10, severe: 20 },
  merit_points: 5,
  baseline: 100,
  floor: 0,
};

// Devuelve la config de conducta de la escuela. Si no existe doc, defaults.
// Tolerante a campos faltantes para versiones viejas del schema.
const getConductConfig = async (schoolId) => {
  if (!schoolId) return { ...DEFAULT_CONDUCT };
  try {
    const doc = await ConductConfig.findOne({ school: schoolId }).lean();
    if (!doc) return { ...DEFAULT_CONDUCT };
    return {
      weights: {
        minor: doc.weights?.minor ?? DEFAULT_CONDUCT.weights.minor,
        moderate: doc.weights?.moderate ?? DEFAULT_CONDUCT.weights.moderate,
        severe: doc.weights?.severe ?? DEFAULT_CONDUCT.weights.severe,
      },
      merit_points: doc.merit_points ?? DEFAULT_CONDUCT.merit_points,
      baseline: doc.baseline ?? DEFAULT_CONDUCT.baseline,
      floor: doc.floor ?? DEFAULT_CONDUCT.floor,
    };
  } catch (err) {
    // Si la colección aún no existe (deploy reciente), no rompemos el flujo
    return { ...DEFAULT_CONDUCT };
  }
};

// Devuelve la magnitud (siempre positiva) del impacto de un evento.
//   - demerit → usa config.weights[severity]
//   - merit   → usa config.merit_points (o el override si se pasa)
const getImpactForEvent = (eventType, severity, config, override) => {
  if (!config) return 0;
  if (eventType === "merit") {
    if (override !== undefined && override !== null) return override;
    return config.merit_points ?? 0;
  }
  // demerit
  if (!severity) return 0;
  return config.weights?.[severity] ?? 0;
};

// Mantenemos este alias para no romper callers viejos que preguntaban
// solo por la deducción de un demerit por severidad.
const getDeductionForSeverity = (severity, config) => {
  if (!config || !config.weights) return 0;
  return config.weights[severity] ?? 0;
};

// Aplica el clamp [floor, baseline] al score. Útil para usar en el
// aggregation result en cualquier controller.
const clampScore = (rawScore, config) => {
  if (!config) return rawScore;
  return Math.max(config.floor, Math.min(config.baseline, rawScore));
};

module.exports = {
  DEFAULT_CONDUCT,
  getConductConfig,
  getImpactForEvent,
  getDeductionForSeverity,
  clampScore,
};
