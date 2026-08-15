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
} = require("../controllers/teacher-subjects.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

router.get(
  "/me/dashboard",
  authorize("teacher"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getTeacherDashboard
);

router.get(
  "/me/groups/:groupId/students",
  authorize("teacher"),
  attachSchoolContext,
  attachActiveSchoolYear,
  getGroupStudents
);

router.post(
  "/me/attendance",
  authorize("teacher"),
  attachSchoolContext,
  attachActiveSchoolYear,
  saveAttendance
);

router.get("/", authorize("admin", "principal", "registrar", "teacher"), getAllTeacherSubjects);
router.post("/", authorize("admin", "registrar"), createTeacherSubject);
router.delete("/:id", authorize("admin", "registrar"), deleteTeacherSubject);

module.exports = router;
