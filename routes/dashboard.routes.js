// Router del Dashboard Super Admin
// Endpoints bajo /api/dashboard. Solo accesible para super_admin.
const express = require("express");
const {
  getSuperAdminDashboard,
  getSchoolSetupStatus,
} = require("../controllers/dashboard.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);
router.use(authorize("super_admin"));

// GET /api/dashboard/super-admin — stats globales
router.get("/super-admin", getSuperAdminDashboard);

// GET /api/dashboard/super-admin/schools/:schoolId/setup-status — wizard de configuración
router.get("/super-admin/schools/:schoolId/setup-status", getSchoolSetupStatus);

module.exports = router;
