// Router de Reportes Disciplinarios
// Endpoints bajo /api/disciplinary-reports (CRUD de staff)
// y la vista del tutor anidada en /api/guardians/me/students/:studentId/disciplinary-reports
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  createReport,
  getAllReports,
  getReportById,
  cancelReport,
  deleteReport,
  REPORTER_ROLES,
  CANCEL_ROLES,
} = require("../controllers/disciplinary-reports.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// POST /api/disciplinary-reports — crear reporte (staff)
router.post("/", authorize(...REPORTER_ROLES), createReport);

// GET /api/disciplinary-reports — listar (staff)
router.get(
  "/",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getAllReports
);

// GET /api/disciplinary-reports/:reportId — detalle
router.get(
  "/:reportId",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getReportById
);

// PUT /api/disciplinary-reports/:reportId/cancel — soft-cancel (solo dirección/registrar)
router.put("/:reportId/cancel", authorize(...CANCEL_ROLES), cancelReport);

// DELETE /api/disciplinary-reports/:reportId — borrado físico (solo super_admin)
router.delete("/:reportId", authorize("super_admin"), deleteReport);

module.exports = router;
