// Router de Guardian (Tutores)
// Endpoints bajo /api/guardians para gestionar tutores/guardianes.
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  attachSchoolContext,
  attachActiveSchoolYear,
  requireGuardianOf,
} = require("../middleware/tenant-context.middleware");
const {
  getAllGuardians,
  getMyGuardians,
  createGuardian,
  getGuardianById,
  updateGuardian,
  deleteGuardian,
  registerFcmToken,
  clearFcmToken,
  getMyDashboard,
  getMyStudentGrades,
  getMyStudentSchedule,
  getMyStudentAttendanceSummary,
  getMyStudentAttendanceHistory,
  getMyAnnouncements,
  confirmMyCitation,
  getMyAnnouncementById,
  getMyCitationById,
} = require("../controllers/guardians.controller");

// Vista del tutor del ledger de conducta de su hijo + resumen del KPI
const {
  getMyStudentLogs,
  getStudentConductSummary,
} = require("../controllers/conduct-logs.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// Rutas con path explícito "me" — DEBEN ir antes que /:guardianId para
// que Express no matchee "me" como un ObjectId.

// --- Dashboard "general" (todos los hijos del tutor en una sola request) ---
// Usa los middlewares de tenant context (no requireGuardianOf porque
// devuelve TODOS los hijos del tutor, no uno específico).
router.get(
  "/me/dashboard",
  attachSchoolContext,
  attachActiveSchoolYear,
  getMyDashboard
);
// --- Feed unificado de avisos + citatorios del tutor (pantalla "Avisos") ---
// Mismo patrón que el dashboard: tenant context, sin requireGuardianOf
// porque el feed es transversal a los hijos. El filtro por hijo se hace
// con ?student_id=... y se valida en el controller.
router.get(
  "/me/announcements",
  attachSchoolContext,
  attachActiveSchoolYear,
  getMyAnnouncements
);
// Detalle de UN aviso del feed (tap en "Leer más" o "Detalles").
// 404 si el aviso no existe o no le corresponde al tutor.
router.get(
  "/me/announcements/:id",
  attachSchoolContext,
  getMyAnnouncementById
);
// Detalle de UN citatorio del feed. 404 si no existe o no es hijo del tutor.
router.get(
  "/me/citations/:id",
  attachSchoolContext,
  getMyCitationById
);
router.get("/me", getMyGuardians);

// --- Vistas de un hijo específico ---
// El orden de los middlewares importa:
//   isAuthenticated           → setea req.payload
//   attachSchoolContext       → setea req.school desde el JWT
//   attachActiveSchoolYear    → setea req.schoolYear (1 query a School)
//   requireGuardianOf         → valida que el tutor es Guardian del student
router.get(
  "/me/students/:studentId/grades",
  attachSchoolContext,
  attachActiveSchoolYear,
  requireGuardianOf,
  getMyStudentGrades
);
// Horario semanal del estudiante (agrupado por día de la semana)
router.get(
  "/me/students/:studentId/schedule",
  attachSchoolContext,
  attachActiveSchoolYear,
  requireGuardianOf,
  getMyStudentSchedule
);
// Resumen de asistencia (% asistencia, faltas, retardos, inasistencias recientes)
router.get(
  "/me/students/:studentId/attendance/summary",
  attachSchoolContext,
  attachActiveSchoolYear,
  requireGuardianOf,
  getMyStudentAttendanceSummary
);
// Historial de entradas/salidas agrupado por día
router.get(
  "/me/students/:studentId/attendance/history",
  attachSchoolContext,
  attachActiveSchoolYear,
  requireGuardianOf,
  getMyStudentAttendanceHistory
);
router.get(
  "/me/students/:studentId/conduct-logs",
  attachSchoolContext,
  attachActiveSchoolYear,
  requireGuardianOf,
  getMyStudentLogs
);
router.get(
  "/me/students/:studentId/conduct-summary",
  attachSchoolContext,
  attachActiveSchoolYear,
  requireGuardianOf,
  getStudentConductSummary
);
// PATCH /me/students/:studentId/citations/:citationId/confirm
// El tutor confirma que ASISTIRÁ a la cita. Solo permite pending → confirmed.
router.patch(
  "/me/students/:studentId/citations/:citationId/confirm",
  attachSchoolContext,
  requireGuardianOf,
  confirmMyCitation
);

router.post("/me/fcm-token", registerFcmToken);
router.delete("/me/fcm-token", clearFcmToken);

// Rutas de admin (escritura)
const adminOnly = authorize("admin", "registrar", "super_admin");

// GET /api/guardians — listar tutores
router.get("/", adminOnly, getAllGuardians);

// POST /api/guardians — crear tutor
router.post("/", adminOnly, createGuardian);

// GET /api/guardians/:guardianId — detalle
router.get("/:guardianId", getGuardianById);

// PUT /api/guardians/:guardianId — actualizar (auth fina en el controller)
router.put("/:guardianId", updateGuardian);

// DELETE /api/guardians/:guardianId — solo admin
router.delete("/:guardianId", adminOnly, deleteGuardian);

module.exports = router;
