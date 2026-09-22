// Router de Ciclos Escolares (SchoolYear)
// Endpoints bajo /api/school-years. Todos requieren JWT.
// Escritura: admin/registrar/super_admin. Lectura: cualquier rol del personal.
const express = require("express");
const {
  getAllSchoolYears,
  createSchoolYear,
  getSchoolYearById,
  updateSchoolYear,
  deleteSchoolYear,
  activateSchoolYear,
  deactivateSchoolYear,
  cloneSchoolYear,
} = require("../controllers/school-years.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

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
const writeRoles = ["admin", "principal", "registrar", "super_admin"];

// GET /api/school-years — listar ciclos de la escuela
router.get("/", authorize(...readRoles), getAllSchoolYears);

// POST /api/school-years — crear un ciclo
router.post("/", authorize(...writeRoles), createSchoolYear);

// GET /api/school-years/:schoolYearId — detalle
router.get("/:schoolYearId", authorize(...readRoles), getSchoolYearById);

// PUT /api/school-years/:schoolYearId — actualizar (name, startDate, endDate)
router.put("/:schoolYearId", authorize(...writeRoles), updateSchoolYear);

// DELETE /api/school-years/:schoolYearId
router.delete("/:schoolYearId", authorize(...writeRoles), deleteSchoolYear);

// POST /api/school-years/:schoolYearId/activate — marca el ciclo vigente
router.post(
  "/:schoolYearId/activate",
  authorize(...writeRoles),
  activateSchoolYear
);

// POST /api/school-years/:schoolYearId/deactivate — desactiva un ciclo
router.post(
  "/:schoolYearId/deactivate",
  authorize(...writeRoles),
  deactivateSchoolYear
);

// POST /api/school-years/:schoolYearId/clone — clona configuración del ciclo anterior
router.post(
  "/:schoolYearId/clone",
  authorize(...writeRoles),
  cloneSchoolYear
);

module.exports = router;
