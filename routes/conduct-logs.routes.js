// Router de ConductLog
// Endpoints bajo /api/conduct-logs (CRUD de staff) y la vista del tutor
// anidada en /api/guardians/me/students/:studentId/conduct-logs
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  createLog,
  getAllLogs,
  getLogById,
  cancelLog,
  deleteLog,
  REPORTER_ROLES,
  CANCEL_ROLES,
} = require("../controllers/conduct-logs.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// POST /api/conduct-logs — crear evento (staff)
router.post("/", authorize(...REPORTER_ROLES), createLog);

// GET /api/conduct-logs — listar (staff)
router.get(
  "/",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getAllLogs
);

// GET /api/conduct-logs/:logId — detalle
router.get(
  "/:logId",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getLogById
);

// PUT /api/conduct-logs/:logId/cancel — soft-cancel (solo dirección/registrar)
router.put("/:logId/cancel", authorize(...CANCEL_ROLES), cancelLog);

// DELETE /api/conduct-logs/:logId — borrado físico (solo super_admin)
router.delete("/:logId", authorize("super_admin"), deleteLog);

module.exports = router;
