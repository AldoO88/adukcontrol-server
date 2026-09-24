// Router de Asignaciones Maestro-Materia-Grupo (TeacherSubject)
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  attachSchoolContext,
  attachActiveSchoolYear,
} = require("../middleware/tenant-context.middleware");
const {
  getAllTeacherSubjects,
  createTeacherSubject,
  deleteTeacherSubject,
  getTeacherDashboard,
  getGroupStudents,
  saveAttendance,
  getMyGroups,
  getTeacherSchedule,
  getTeacherAttendanceSummary,
  getMyGroupsWithSchedule,
  getGradingPeriods,
  getAttendanceSessions,
  createAttendanceSession,
  updateAttendanceRecord,
  getGradeConfig,
  upsertGradeConfig,
  getEvaluationTypes,
  createEvaluationType,
  deleteEvaluationType,
  updateEvaluationType,
  getGroupStudentsSummary,
  getStudentFile,
  getStudentTutoriaFile,
  getGrades,
  saveGrade,
  closeGrades,
  openGrades,
} = require("../controllers/teacher-subjects.controller");
const {
  getGradesValidation,
} = require("../controllers/grades-validation.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

router.get(
  "/me/groups",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getMyGroups
);

router.get(
  "/me/dashboard",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getTeacherDashboard
);

router.get(
  "/me/schedule",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getTeacherSchedule
);

router.get(
  "/me/attendance-summary",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getTeacherAttendanceSummary
);

router.get(
  "/me/groups-with-schedule",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getMyGroupsWithSchedule
);

router.get(
  "/me/group-students-summary",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getGroupStudentsSummary
);

router.get(
  "/me/student-file",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getStudentFile
);

router.get(
  "/me/student-tutoria-file",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getStudentTutoriaFile
);

// Estado de cierre de calificaciones por (grupo, materia) para un período.
// Pantalla "Validación de Calificaciones" del front.
router.get(
  "/me/grades/validation",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getGradesValidation
);

router.get(
  "/me/groups/:groupId/students",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getGroupStudents
);

router.post(
  "/me/attendance",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  saveAttendance
);

router.get(
  "/me/grading-periods",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getGradingPeriods
);

router.get(
  "/me/attendance-sessions",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getAttendanceSessions
);

router.post(
  "/me/attendance-sessions",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  createAttendanceSession
);

router.patch(
  "/me/attendance-sessions/:sessionId/records/:studentId",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  updateAttendanceRecord
);

// ─── Calificaciones (Grading System) ───────────────────────────────

router.get(
  "/me/grade-config",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getGradeConfig
);

router.put(
  "/me/grade-config",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  upsertGradeConfig
);

router.get(
  "/me/evaluation-types",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getEvaluationTypes
);

router.post(
  "/me/evaluation-types",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  createEvaluationType
);

router.delete(
  "/me/evaluation-types/:evaluationTypeId",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  deleteEvaluationType
);

router.put(
  "/me/evaluation-types/:evaluationTypeId",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  updateEvaluationType
);

router.get(
  "/me/grades",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getGrades
);

router.post(
  "/me/grades",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  saveGrade
);

router.post(
  "/me/grades/close",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  closeGrades
);

router.post(
  "/me/grades/open",
  authorize("teacher", "super_admin"),
  attachSchoolContext,
  attachActiveSchoolYear,
  openGrades
);

router.get("/", authorize("admin", "principal", "registrar", "teacher", "prefect", "super_admin"), getAllTeacherSubjects);
router.post("/", authorize("admin", "registrar", "super_admin"), createTeacherSubject);
router.delete("/:id", authorize("admin", "registrar", "super_admin"), deleteTeacherSubject);

module.exports = router;
