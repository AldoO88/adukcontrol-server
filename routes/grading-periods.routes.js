// Router de Períodos de Evaluación (GradingPeriod)
// Endpoints bajo /api/grading-periods. Todos requieren JWT.
// Escritura: admin/registrar/super_admin. Lectura: cualquier rol del personal.
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  getAllPeriods,
  createPeriod,
  getPeriodById,
  updatePeriod,
  deletePeriod,
} = require("../controllers/grading-periods.controller");

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

// GET /api/grading-periods — listar períodos
router.get("/", authorize(...readRoles), getAllPeriods);

// POST /api/grading-periods — crear período
router.post("/", authorize(...writeRoles), createPeriod);

// GET /api/grading-periods/:periodId — detalle
router.get("/:periodId", authorize(...readRoles), getPeriodById);

// PUT /api/grading-periods/:periodId — actualizar
router.put("/:periodId", authorize(...writeRoles), updatePeriod);

// DELETE /api/grading-periods/:periodId — eliminar
router.delete("/:periodId", authorize(...writeRoles), deletePeriod);

module.exports = router;
