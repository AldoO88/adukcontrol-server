// =====================================================================
// routes/exit-pass.routes.js
// ---------------------------------------------------------------------
// Rutas para Pases de Salida (Exit Pass).
// Endpoints bajo /api/exit-passes. Auth: JWT + staff.
// =====================================================================

const express = require("express");
const {
  createExitPass,
  listExitPasses,
  getExitPassById,
  cancelExitPass,
} = require("../controllers/exit-pass.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const { Router } = express;
const router = Router();

const STAFF_ROLES = [
  "admin",
  "principal",
  "registrar",
  "prefect",
  "social_worker",
  "super_admin",
];

// POST /api/exit-passes
// Crear un pase de salida. Auth: JWT + staff.
router.post(
  "/",
  isAuthenticated,
  authorize(...STAFF_ROLES),
  createExitPass
);

// GET /api/exit-passes
// Lista paginada de pases de salida. Auth: JWT + staff.
router.get(
  "/",
  isAuthenticated,
  authorize(...STAFF_ROLES),
  listExitPasses
);

// GET /api/exit-passes/:id
// Detalle de un pase de salida. Auth: JWT + staff.
router.get(
  "/:id",
  isAuthenticated,
  authorize(...STAFF_ROLES),
  getExitPassById
);

// PATCH /api/exit-passes/:id/cancel
// Cancelar un pase de salida. Auth: JWT + staff.
router.patch(
  "/:id/cancel",
  isAuthenticated,
  authorize(...STAFF_ROLES),
  cancelExitPass
);

module.exports = router;
