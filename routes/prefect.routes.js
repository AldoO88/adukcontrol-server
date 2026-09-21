// Router del Prefecto
// Rutas bajo /api/prefect para funcionalidades del prefecto.
const express = require("express");
const { Router } = express;
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  attachSchoolContext,
  attachActiveSchoolYear,
} = require("../middleware/tenant-context.middleware");
const {
  getPrefectDashboard,
  getPrefectAttendanceSummary,
  getTeacherScheduleById,
  getGroupsSummary,
  getAllTeachersForPrefect,
  getTeacherDetailForPrefect,
  getSchoolAbsences,
} = require("../controllers/prefect.controller");

const router = Router();

// Todas las rutas requieren JWT + role prefect
router.use(isAuthenticated);
router.use(authorize("prefect", "super_admin"));
router.use(attachSchoolContext);
router.use(attachActiveSchoolYear);

// GET /api/prefect/dashboard — resumen general
router.get("/dashboard", getPrefectDashboard);

// GET /api/prefect/attendance-summary — asistencia school-wide
router.get("/attendance-summary", getPrefectAttendanceSummary);

// GET /api/prefect/teachers — lista todos los maestros de la escuela
router.get("/teachers", getAllTeachersForPrefect);

// GET /api/prefect/teachers/:teacherId — detalle de un maestro (datos + materias + grupos)
router.get("/teachers/:teacherId", getTeacherDetailForPrefect);

// GET /api/prefect/teacher-schedule/:teacherId — horario de cualquier maestro
router.get("/teacher-schedule/:teacherId", getTeacherScheduleById);

// GET /api/prefect/groups-summary — estadísticas de todos los grupos
router.get("/groups-summary", getGroupsSummary);

// GET /api/prefect/school-absences — top alumnos con más faltas escolares
router.get("/school-absences", getSchoolAbsences);

module.exports = router;
