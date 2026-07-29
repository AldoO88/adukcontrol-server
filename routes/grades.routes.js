// Router de Calificaciones (Grade)
//   - Rutas por student: /api/students/:studentId/grades
//   - Rutas por grade individual: /api/grades/:gradeId
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  createGrade,
  getStudentGrades,
  getStudentGradesSummary,
  updateGrade,
  deleteGrade,
} = require("../controllers/grades.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// Rutas con path explícito DEBEN ir antes que /:param para evitar
// que Express las matchee como un ObjectId.
// Pero como las rutas están en distintos routers, este router maneja
// tanto /api/students/:studentId/grades como /api/grades/:gradeId.
// Aquí definimos los handlers; el mounting se hace en index.routes.

const studentOnlyGrades = Router({ mergeParams: true });
studentOnlyGrades.post("/", createGrade);
studentOnlyGrades.get("/", getStudentGrades);
studentOnlyGrades.get("/summary", getStudentGradesSummary);

const gradeById = Router();
gradeById.put("/:gradeId", updateGrade);
gradeById.delete("/:gradeId", deleteGrade);

module.exports = { studentOnlyGrades, gradeById };
