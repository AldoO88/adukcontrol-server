const express = require("express"); // Módulo Express
const { // Controladores
  getAllEnrollments,
  createEnrollment,
  getEnrollmentById,
  updateEnrollment,
  deleteEnrollment,
} = require("../controllers/enrollments.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware"); // Middleware JWT
const { authorize } = require("../middleware/authorize.middleware"); // Middleware de roles

const { Router } = express; // Desestructurar Router
const router = Router(); // Construir sub-router

router.use(isAuthenticated); // Requerir JWT válido

router.get( // GET /api/enrollments
  "/",
  authorize("admin", "control_escolar", "maestro", "prefecto"), // Cualquier personal
  getAllEnrollments
);
router.post("/", authorize("admin", "control_escolar"), createEnrollment); // POST /api/enrollments
router.get( // GET /api/enrollments/:idEnrollment
  "/:idEnrollment",
  authorize("admin", "control_escolar", "maestro", "prefecto"), // Cualquier personal
  getEnrollmentById
);
router.put( // PUT /api/enrollments/:idEnrollment
  "/:idEnrollment",
  authorize("admin", "control_escolar"), // Solo admin o control escolar
  updateEnrollment
);
router.delete( // DELETE /api/enrollments/:idEnrollment
  "/:idEnrollment",
  authorize("admin", "control_escolar"), // Solo admin o control escolar
  deleteEnrollment
);

module.exports = router; // Exportar
