// Router de Turnos / Campanas (SchoolShift)
// Endpoints bajo /api/school-shifts. Todos requieren JWT.
// Escritura: admin/registrar/super_admin. Lectura: cualquier rol del personal.
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  getAllShifts,
  createShift,
  getShiftById,
  updateShift,
  deleteShift,
} = require("../controllers/school-shifts.controller");

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
  "super_admin",
];
const writeRoles = ["admin", "registrar", "super_admin"];

// GET /api/school-shifts — listar turnos
router.get("/", authorize(...readRoles), getAllShifts);

// POST /api/school-shifts — crear turno
router.post("/", authorize(...writeRoles), createShift);

// GET /api/school-shifts/:shiftId — detalle
router.get("/:shiftId", authorize(...readRoles), getShiftById);

// PUT /api/school-shifts/:shiftId — actualizar
router.put("/:shiftId", authorize(...writeRoles), updateShift);

// DELETE /api/school-shifts/:shiftId — eliminar
router.delete("/:shiftId", authorize(...writeRoles), deleteShift);

module.exports = router;
