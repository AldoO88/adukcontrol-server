const express = require("express"); // Módulo Express
const router = express.Router(); // Construir sub-router
const studentsRouter = require("./students.routes"); // Sub-router de /students
const attendanceRouter = require("./attendance.routes"); // Sub-router de /attendance
const groupsRouter = require("./groups.routes"); // Sub-router de /groups
const enrollmentsRouter = require("./enrollments.routes"); // Sub-router de /enrollments

router.get("/", (req, res, next) => { // Health check bajo /api
  res.json({ message: "Eduk Control API — all good in here" }); // OK
});

router.use("/students", studentsRouter); // Montar sub-router de estudiantes
router.use("/attendance", attendanceRouter); // Montar sub-router de asistencia
router.use("/groups", groupsRouter); // Montar sub-router de grupos
router.use("/enrollments", enrollmentsRouter); // Montar sub-router de inscripciones

module.exports = router; // Exportar
