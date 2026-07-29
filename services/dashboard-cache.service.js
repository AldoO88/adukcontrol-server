// Servicio compartido de invalidación de cache del dashboard
// Centraliza las keys que `getMyDashboard` (y derivados) cachea, para que
// cualquier controller que modifique data que afecta esos KPIs pueda
// invalidar el cache del tutor afectado sin duplicar lógica.
//
// Keys que se invalidan para un (userId, studentId):
//   - dashboard:<userId>:*                 → cache del getMyDashboard
//   - student-grades:<userId>:<studentId>*  → cache de getMyStudentGrades
//   - student-kpis:<userId>:<studentId>*    → cache de getMyStudentKpis (futuro)
//
// Uso:
//   const { invalidateStudentDashboardCache } = require("../services/dashboard-cache.service");
//   await invalidateStudentDashboardCache(studentId);
const Guardian = require("../models/Guardian.model");
const cache = require("./cache.service");

// Recolecta los userIds de los tutores (Guardians) que tienen a este student
// en su lista de hijos. Un student puede tener varios tutores; un tutor
// puede tener varios hijos.
const collectGuardianUserIds = async (studentId) => {
  const guardianRecords = await Guardian.find({ students: studentId })
    .select("user_id")
    .lean();
  // Filtramos null (tutores sin user_id aún no activaron su cuenta)
  return guardianRecords
    .map((g) => (g.user_id ? String(g.user_id) : null))
    .filter(Boolean);
};

// Invalida el cache de dashboard de TODOS los tutores del student.
// No crítico si falla: el cache tiene TTL de 5 min y se autorrecupera.
const invalidateStudentDashboardCache = async (studentId) => {
  try {
    const userIds = await collectGuardianUserIds(studentId);
    for (const uid of userIds) {
      await cache.invalidatePattern(`dashboard:${uid}:*`);
      await cache.invalidatePattern(`student-grades:${uid}:${studentId}*`);
      await cache.invalidatePattern(`student-kpis:${uid}:${studentId}*`);
    }
  } catch (err) {
    console.warn(
      `[dashboard-cache] invalidateStudentDashboardCache failed: ${err.message}`
    );
  }
};

module.exports = {
  invalidateStudentDashboardCache,
  collectGuardianUserIds,
};
