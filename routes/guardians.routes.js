// Router de Guardian (Tutores)
// Endpoints bajo /api/guardians para gestionar tutores/guardianes.
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  getAllGuardians,
  getMyGuardians,
  createGuardian,
  getGuardianById,
  updateGuardian,
  deleteGuardian,
  registerFcmToken,
  clearFcmToken,
  getMyDashboard,
  getMyStudentGrades,
} = require("../controllers/guardians.controller");

// Vista del tutor de los reportes disciplinarios de su hijo
const { getMyStudentReports } = require("../controllers/disciplinary-reports.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// Rutas con path explícito "me" — DEBEN ir antes que /:guardianId para
// que Express no matchee "me" como un ObjectId.
router.get("/me/dashboard", getMyDashboard);
router.get("/me", getMyGuardians);
router.get("/me/students/:studentId/grades", getMyStudentGrades);
router.get(
  "/me/students/:studentId/disciplinary-reports",
  getMyStudentReports
);
router.post("/me/fcm-token", registerFcmToken);
router.delete("/me/fcm-token", clearFcmToken);

// Rutas de admin (escritura)
const adminOnly = authorize("admin", "registrar", "super_admin");

// GET /api/guardians — listar tutores
router.get("/", adminOnly, getAllGuardians);

// POST /api/guardians — crear tutor
router.post("/", adminOnly, createGuardian);

// GET /api/guardians/:guardianId — detalle
router.get("/:guardianId", getGuardianById);

// PUT /api/guardians/:guardianId — actualizar (auth fina en el controller)
router.put("/:guardianId", updateGuardian);

// DELETE /api/guardians/:guardianId — solo admin
router.delete("/:guardianId", adminOnly, deleteGuardian);

module.exports = router;
