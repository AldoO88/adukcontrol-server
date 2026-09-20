// =====================================================================
// routes/director.routes.js
// ---------------------------------------------------------------------
// Rutas bajo /api/director para funcionalidades del Director (rol principal).
// Reutiliza controladores de prefect y social-worker + dashboard propio.
// =====================================================================

const express = require("express");
const { Router } = express;
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  attachSchoolContext,
  attachActiveSchoolYear,
} = require("../middleware/tenant-context.middleware");

// Controlador del Director (dashboard propio)
const {
  getDirectorDashboard,
} = require("../controllers/director.controller");

// Controladores reutilizados de Prefect
const {
  getPrefectAttendanceSummary,
  getGroupsSummary,
  getAllTeachersForPrefect,
  getTeacherDetailForPrefect,
  getTeacherScheduleById,
  getSchoolAbsences,
} = require("../controllers/prefect.controller");

// Controladores reutilizados de Social Worker (expediente)
const {
  getStudentHealth,
  updateStudentHealth,
  getAllStudents,
} = require("../controllers/students.controller");

const {
  getAgreementsByStudent,
  createAgreement,
  updateAgreement,
  getReferralsByStudent,
  createReferral,
  updateReferral,
} = require("../controllers/social-worker-case.controller");

// Controladores compartidos (avisos, citatorios, conducta, etc.)
const {
  getAnnouncementById,
  getAllAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} = require("../controllers/announcements.controller");

const {
  getAllLogs,
  getLogById,
  createLog,
  updateLog,
  cancelLog,
  deleteLog,
} = require("../controllers/conduct-logs.controller");

const {
  getAllCitations,
  getCitationById,
  createCitation,
  updateCitation,
  rescheduleCitation,
  cancelCitation,
  deleteCitation,
} = require("../controllers/citations.controller");

const {
  listExitPasses,
  getExitPassById,
  createExitPass,
  cancelExitPass,
} = require("../controllers/exit-pass.controller");

const {
  getConfig: getConductConfig,
} = require("../controllers/conduct-config.controller");

// Controladores reutilizados de Prefect (grupos, alumnos, maestros)
const {
  getAllGroups,
  getGroupStudents,
} = require("../controllers/groups.controller");

const router = Router();

// Todas las rutas requieren JWT + role principal (Director)
router.use(isAuthenticated);
router.use(authorize("principal"));
router.use(attachSchoolContext);
router.use(attachActiveSchoolYear);

// =====================================================================
// DASHBOARD
// =====================================================================
router.get("/dashboard", getDirectorDashboard);

// =====================================================================
// GRUPOS, ALUMNOS, MAESTROS (lectura — reutiliza de prefect)
// =====================================================================
router.get("/groups", getAllGroups);
router.get("/groups-summary", getGroupsSummary);
router.get("/students", getAllStudents);
router.get("/students/:studentId/health", getStudentHealth);
router.patch("/students/:studentId/health", updateStudentHealth);
router.get("/teachers", getAllTeachersForPrefect);
router.get("/teachers/:teacherId", getTeacherDetailForPrefect);
router.get("/teacher-schedule/:teacherId", getTeacherScheduleById);
router.get("/school-absences", getSchoolAbsences);

// =====================================================================
// ACUERDOS CON PADRES (expediente)
// =====================================================================
router.get("/students/:studentId/agreements", getAgreementsByStudent);
router.post("/students/:studentId/agreements", createAgreement);
router.patch("/agreements/:id", updateAgreement);

// =====================================================================
// REFERENCIAS A INSTITUCIONES
// =====================================================================
router.get("/students/:studentId/referrals", getReferralsByStudent);
router.post("/students/:studentId/referrals", createReferral);
router.patch("/referrals/:id", updateReferral);

// =====================================================================
// ASISTENCIA
// =====================================================================
router.get("/attendance-summary", getPrefectAttendanceSummary);

// =====================================================================
// AVISOS (CRUD completo — el Director puede crear/editar/eliminar)
// =====================================================================
router.get("/announcements", getAllAnnouncements);
router.get("/announcements/:id", getAnnouncementById);
router.post("/announcements", createAnnouncement);
router.patch("/announcements/:id", updateAnnouncement);
router.delete("/announcements/:id", deleteAnnouncement);

// =====================================================================
// REPORTES DE CONDUCTA (CRUD completo)
// =====================================================================
router.get("/conduct-logs", getAllLogs);
router.get("/conduct-logs/:logId", getLogById);
router.post("/conduct-logs", createLog);
router.put("/conduct-logs/:logId", updateLog);
router.put("/conduct-logs/:logId/cancel", cancelLog);
router.delete("/conduct-logs/:logId", deleteLog);

// =====================================================================
// CITATORIOS (CRUD completo)
// =====================================================================
router.get("/citations", getAllCitations);
router.get("/citations/:id", getCitationById);
router.post("/citations", createCitation);
router.put("/citations/:id", updateCitation);
router.patch("/citations/:id/reschedule", rescheduleCitation);
router.patch("/citations/:id/cancel", cancelCitation);
router.delete("/citations/:id", deleteCitation);

// =====================================================================
// PASES DE SALIDA (CRUD completo)
// =====================================================================
router.get("/exit-passes", listExitPasses);
router.get("/exit-passes/:id", getExitPassById);
router.post("/exit-passes", createExitPass);
router.patch("/exit-passes/:id/cancel", cancelExitPass);

// =====================================================================
// CONFIG DE CONDUCTA
// =====================================================================
router.get("/conduct-config", getConductConfig);

module.exports = router;
