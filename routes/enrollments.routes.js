// Router de Inscripciones
// Endpoints bajo /api/enrollments. Todos requieren JWT.
// Escritura: admin o registrar. Lectura: cualquier rol del personal.
const express = require("express");
const {
  getAllEnrollments,
  createEnrollment,
  getEnrollmentById,
  updateEnrollment,
  deleteEnrollment,
} = require("../controllers/enrollments.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// GET /api/enrollments — listar con filtros
router.get(
  "/",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getAllEnrollments
);

// POST /api/enrollments — crear una inscripción
router.post("/", authorize("admin", "registrar"), createEnrollment);

// GET /api/enrollments/:enrollmentId — detalle
router.get(
  "/:enrollmentId",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getEnrollmentById
);

// PUT /api/enrollments/:enrollmentId — actualizar (cambiar grupo, egresado, etc.)
router.put(
  "/:enrollmentId",
  authorize("admin", "registrar"),
  updateEnrollment
);

// DELETE /api/enrollments/:enrollmentId — eliminar
router.delete(
  "/:enrollmentId",
  authorize("admin", "registrar"),
  deleteEnrollment
);

module.exports = router;
