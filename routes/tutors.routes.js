// Router de Tutores
// Endpoints bajo /api/tutors para gestionar la relación tutor↔estudiantes.
// Todas las rutas requieren JWT; la autorización fina (dueño vs admin)
// se valida dentro del controller.
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const {
  getTutorStudents,
  updateTutorStudents,
} = require("../controllers/tutors.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// GET /api/tutors/:userId/students — listar estudiantes del tutor
router.get("/:userId/students", getTutorStudents);

// PUT /api/tutors/:userId/students — reemplazar la lista
router.put("/:userId/students", updateTutorStudents);

module.exports = router;
