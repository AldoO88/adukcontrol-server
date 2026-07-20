// Router de Estudiantes
// Endpoints bajo /api/students. Todos requieren JWT.
// Escritura: admin o registrar. Lectura: cualquier rol del personal.
const express = require("express");
const {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
} = require("../controllers/students.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const { Router } = express;
const router = Router();

router.use(isAuthenticated); // Todas las rutas requieren JWT

// POST /api/students/register — crear estudiante
router.post(
  "/register",
  authorize("admin", "registrar"),
  createStudent
);

// GET /api/students — listar con paginación y filtros
router.get(
  "/",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getAllStudents
);

// GET /api/students/:studentId — detalle de un estudiante
router.get(
  "/:studentId",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getStudentById
);

// PUT /api/students/:studentId — actualizar un estudiante
router.put(
  "/:studentId",
  authorize("admin", "registrar"),
  updateStudent
);

// DELETE /api/students/:studentId — eliminar un estudiante
router.delete(
  "/:studentId",
  authorize("admin", "registrar"),
  deleteStudent
);

module.exports = router;
