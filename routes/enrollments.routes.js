// Router de Inscripciones
// Endpoints bajo /api/enrollments. Todos requieren JWT.
const express = require("express");
const {
  getAllEnrollments,
  createEnrollment,
  getEnrollmentById,
  updateEnrollment,
  deleteEnrollment,
  importEnrollmentsFromSpreadsheet,
} = require("../controllers/enrollments.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const { uploadSpreadsheetSingle } = require("../middleware/spreadsheet-upload.middleware");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

const readRoles = [
  "admin",
  "principal",
  "registrar",
  "teacher",
  "prefect",
  "social_worker",
];
const writeRoles = ["admin", "registrar", "super_admin"];

// GET /api/enrollments — listar con filtros
router.get("/", authorize(...readRoles), getAllEnrollments);

// POST /api/enrollments — crear una inscripción
router.post("/", authorize("admin", "registrar"), createEnrollment);

// POST /api/enrollments/import — carga masiva desde Excel
router.post(
  "/import",
  authorize(...writeRoles),
  uploadSpreadsheetSingle("file"),
  importEnrollmentsFromSpreadsheet
);

// GET /api/enrollments/:enrollmentId — detalle
router.get("/:enrollmentId", authorize(...readRoles), getEnrollmentById);

// PUT /api/enrollments/:enrollmentId — actualizar
router.put("/:enrollmentId", authorize("admin", "registrar"), updateEnrollment);

// DELETE /api/enrollments/:enrollmentId — eliminar
router.delete("/:enrollmentId", authorize("admin", "registrar"), deleteEnrollment);

module.exports = router;
