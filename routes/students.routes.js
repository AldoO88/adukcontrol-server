const express = require("express"); // Módulo Express
const { // Controladores
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
} = require("../controllers/students.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware"); // Middleware JWT
const { authorize } = require("../middleware/authorize.middleware"); // Middleware de roles

const { Router } = express; // Desestructurar Router
const router = Router(); // Construir sub-router

router.use(isAuthenticated); // Requerir JWT válido en todas las rutas

router.post( // POST /api/students/register
  "/register",
  authorize("admin", "control_escolar"), // Solo admin o control escolar
  createStudent
);

router.get( // GET /api/students
  "/",
  authorize("admin", "control_escolar", "maestro", "prefecto"), // Cualquier personal
  getAllStudents
);

router.get( // GET /api/students/:idStudent
  "/:idStudent",
  authorize("admin", "control_escolar", "maestro", "prefecto"), // Cualquier personal
  getStudentById
);

router.put( // PUT /api/students/:idStudent
  "/:idStudent",
  authorize("admin", "control_escolar"), // Solo admin o control escolar
  updateStudent
);

router.delete( // DELETE /api/students/:idStudent
  "/:idStudent",
  authorize("admin", "control_escolar"), // Solo admin o control escolar
  deleteStudent
);

module.exports = router; // Exportar
