// Servicio de Conducta
// Resuelve la configuración de descuentos por severidad de cada escuela.
// Si la escuela nunca creó su ConductConfig, devuelve los defaults.
//
// Regla de negocio:
//   score = max(baseline - sum(points_deduction de reportes activos del año), floor)
// El `points_deduction` se congela al momento de crear el reporte (no se
// recalcula contra esta config), por lo que cambios futuros en `weights`
// NO afectan reportes ya creados.
const ConductConfig = require("../models/ConductConfig.model");

// Defaults cuando la escuela no tiene ConductConfig.
const DEFAULT_CONDUCT = {
  weights: { minor: 5, moderate: 10, severe: 20 },
  baseline: 100,
  floor: 0,
};

// Devuelve la config de conducta de la escuela. Si no existe doc, defaults.
const getConductConfig = async (schoolId) => {
  if (!schoolId) return { ...DEFAULT_CONDUCT };
  try {
    const doc = await ConductConfig.findOne({ school: schoolId }).lean();
    if (!doc) return { ...DEFAULT_CONDUCT };
    // Mezcla con defaults para tolerar docs viejos sin algún campo
    return {
      weights: {
        minor: doc.weights?.minor ?? DEFAULT_CONDUCT.weights.minor,
        moderate: doc.weights?.moderate ?? DEFAULT_CONDUCT.weights.moderate,
        severe: doc.weights?.severe ?? DEFAULT_CONDUCT.weights.severe,
      },
      baseline: doc.baseline ?? DEFAULT_CONDUCT.baseline,
      floor: doc.floor ?? DEFAULT_CONDUCT.floor,
    };
  } catch (err) {
    // Si la colección aún no existe (deploy reciente), no rompemos el flujo
    return { ...DEFAULT_CONDUCT };
  }
};

// Devuelve los puntos a descontar para una severidad según la config.
// Helper para el controller de creación de reportes.
const getDeductionForSeverity = (severity, config) => {
  if (!config || !config.weights) return 0;
  return config.weights[severity] ?? 0;
};

module.exports = {
  DEFAULT_CONDUCT,
  getConductConfig,
  getDeductionForSeverity,
};
