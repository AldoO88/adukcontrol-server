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
  uploadStudentPhoto,
  getStudentPhotoVersions,
  rollbackStudentPhoto,
  promoteStudent,
  getStudentEnrollments,
  getStudentAcademicHistory,
  promoteStudentsBulk,
  getStudentHealth,
  updateStudentHealth,
} = require("../controllers/students.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const { uploadSingle } = require("../middleware/upload.middleware");

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
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getAllStudents
);

// GET /api/students/:studentId — detalle de un estudiante
router.get(
  "/:studentId",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getStudentById
);

// PUT /api/students/:studentId — actualizar un estudiante
router.put(
  "/:studentId",
  authorize("admin", "registrar", "super_admin"),
  updateStudent
);

// DELETE /api/students/:studentId — eliminar un estudiante
router.delete(
  "/:studentId",
  authorize("admin", "registrar", "super_admin"),
  deleteStudent
);

// Rutas con path explícito "photo/...", "promote", "enrollments" — DEBEN
// ir antes que /:studentId (Express matchearía esos segmentos como un ObjectId).
router.post(
  "/:studentId/photo",
  authorize("admin", "registrar", "super_admin"),
  uploadSingle("photo"),
  uploadStudentPhoto
);
router.get("/:studentId/photo/versions", getStudentPhotoVersions);
router.post("/:studentId/photo/rollback", rollbackStudentPhoto);

// GET /api/students/:studentId/health — ficha de salud e inclusión
router.get(
  "/:studentId/health",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getStudentHealth
);

// PATCH /api/students/:studentId/health — actualizar ficha de salud e inclusión
router.patch(
  "/:studentId/health",
  authorize("admin", "principal", "social_worker"),
  updateStudentHealth
);

// POST /api/students/:studentId/promote — promover al siguiente ciclo escolar
router.post(
  "/:studentId/promote",
  authorize("admin", "registrar", "super_admin"),
  promoteStudent
);

// GET /api/students/:studentId/enrollments — historial académico
router.get(
  "/:studentId/enrollments",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getStudentEnrollments
);

// GET /api/students/:studentId/academic-history — vista consolidada
router.get(
  "/:studentId/academic-history",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getStudentAcademicHistory
);

// POST /api/students/promote-bulk — DEBE ir antes que /:studentId
// (Express matchearía "promote-bulk" como un ObjectId si no)
router.post(
  "/promote-bulk",
  authorize("admin", "registrar", "super_admin"),
  promoteStudentsBulk
);

module.exports = router;
