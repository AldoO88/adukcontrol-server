// Router de Horarios de Clase (ClassSchedule)
// Endpoints bajo /api/class-schedules. Todos requieren JWT.
// Escritura: admin/registrar. Lectura: cualquier rol del personal.
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  getAllSchedules,
  createSchedule,
  deleteSchedule,
} = require("../controllers/class-schedules.controller");

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
const writeRoles = ["admin", "registrar"];

// GET /api/class-schedules — listar horarios
router.get("/", authorize(...readRoles), getAllSchedules);

// POST /api/class-schedules — crear horario
router.post("/", authorize(...writeRoles), createSchedule);

// DELETE /api/class-schedules/:scheduleId — eliminar horario
router.delete("/:scheduleId", authorize(...writeRoles), deleteSchedule);

module.exports = router;
