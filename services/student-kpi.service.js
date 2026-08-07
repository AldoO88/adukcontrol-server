// Servicio de KPIs del Guardian Dashboard
// Funciones puras que calculan los indicadores por estudiante.
// Reciben IDs, devuelven payloads listos para serializar. NO tienen
// dependencias HTTP — el controller las envuelve en try/catch + res.json.
//
// Convenciones del módulo:
//   - Validan ObjectId antes de tocar la DB.
//   - Usan .lean() en los find() y aggregation pipelines optimizados.
//   - Las queries se diseñan para aprovechar los índices compuestos
//     definidos en cada modelo (ver `models/*.model.js`).
const mongoose = require("mongoose");
const ConductLog = require("../models/ConductLog.model");
const {
  getConductConfig,
  clampScore,
} = require("./conduct.service");

// Helper: valida y convierte a ObjectId. Lanza un error etiquetado si falla
// para que el controller lo pueda traducir a 400/404 según el contexto.
const toObjectId = (id, label) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const err = new Error(`Invalid ${label}: ${id}`);
    err.code = "INVALID_ID";
    err.statusCode = 400;
    throw err;
  }
  return new mongoose.Types.ObjectId(id);
};

// ---------------------------------------------------------------------------
// KPI: Conduct Score (ledger-style: merits + demerits)
// ---------------------------------------------------------------------------
// Reglas de negocio (ver bloque en models/ConductLog.model.js):
//   score = clamp(baseline + signedTotal, floor, baseline)
//   donde signedTotal = sum(points_impact de merits)
//                   - sum(points_impact de demerits)
//
//   El `signedTotal` se computa en UNA sola aggregation de Mongo con
//   $cond (no hace falta traer los documentos a memoria para sumarlos).
//
// Queries:
//   1) Suma histórica → 1 aggregation. El $match usa el prefijo
//      { school, student_id } del índice `idx_school_student_year_status`
//      (filtrar status en memoria es barato: cada alumno tiene pocos logs).
//   2) Logs del año actual → find() que usa el índice COMPLETO
//      { school, student_id, school_year_id, status }. Populate client-side.
//
// @param {string} studentId
// @param {string} currentSchoolYearId
// @param {string} schoolId
// @returns {Promise<{
//   currentScore: number,
//   baseline: number,
//   floor: number,
//   signedTotal: number,             // merits (+) - demerits (-)
//   totalEventsAllTime: number,
//   demeritsCountAllTime: number,
//   meritsCountAllTime: number,
//   currentYearLogs: object[]        // logs del ciclo actual (para la UI)
// }>}
const getConductKpi = async (studentId, currentSchoolYearId, schoolId) => {
  const sid = toObjectId(studentId, "studentId");
  const yid = toObjectId(currentSchoolYearId, "currentSchoolYearId");
  const scid = toObjectId(schoolId, "schoolId");

  // Config de conducta de la escuela (con defaults si nunca la creó)
  const config = await getConductConfig(schoolId);

  // ===== Query 1: Suma histórica con signo =====
  // Una sola pasada: $match por índice + $group con $cond que aplica signo.
  const historicalAgg = await ConductLog.aggregate([
    {
      $match: {
        school: scid,
        student_id: sid,
        status: "active",
      },
    },
    {
      $group: {
        _id: null,
        signedTotal: {
          $sum: {
            $cond: [
              { $eq: ["$eventType", "merit"] },
              "$points_impact",
              { $multiply: ["$points_impact", -1] }, // demerit → negativo
            ],
          },
        },
        total_events: { $sum: 1 },
        demerits_count: {
          $sum: { $cond: [{ $eq: ["$eventType", "demerit"] }, 1, 0] },
        },
        merits_count: {
          $sum: { $cond: [{ $eq: ["$eventType", "merit"] }, 1, 0] },
        },
      },
    },
  ]);

  const signedTotal = historicalAgg[0]?.signedTotal ?? 0;
  const totalEventsAllTime = historicalAgg[0]?.total_events ?? 0;
  const demeritsCountAllTime = historicalAgg[0]?.demerits_count ?? 0;
  const meritsCountAllTime = historicalAgg[0]?.merits_count ?? 0;

  // score = clamp(baseline + signedTotal, floor, baseline)
  const rawScore = config.baseline + signedTotal;
  const currentScore = clampScore(rawScore, config);

  // ===== Query 2: Logs del ciclo actual (para mostrar al tutor) =====
  // $match usa el índice COMPLETO. .lean() evita hidratación de Mongoose.
  // Ordenamos por incident_date desc (más recientes primero) y separamos
  // merits de demerits dentro del JS para que la UI los agrupe fácil.
  const currentYearLogs = await ConductLog.find({
    school: scid,
    student_id: sid,
    school_year_id: yid,
    status: "active",
  })
    .populate("reported_by", "name email role")
    .populate("school_year_id", "name startDate endDate isActive")
    .sort({ incident_date: -1, createdAt: -1 })
    .lean();

  return {
    currentScore,
    baseline: config.baseline,
    floor: config.floor,
    signedTotal,
    totalEventsAllTime,
    demeritsCountAllTime,
    meritsCountAllTime,
    currentYearLogs,
  };
};

module.exports = {
  getConductKpi,
};
