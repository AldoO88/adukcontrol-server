// Router de Asignaciones Maestro-Materia-Grupo (TeacherSubject)
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  getAllTeacherSubjects,
  createTeacherSubject,
  deleteTeacherSubject,
} = require("../controllers/teacher-subjects.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

router.get("/", authorize("admin", "principal", "registrar", "teacher"), getAllTeacherSubjects);
router.post("/", authorize("admin", "registrar"), createTeacherSubject);
router.delete("/:id", authorize("admin", "registrar"), deleteTeacherSubject);

module.exports = router;
