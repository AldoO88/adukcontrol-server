// Router de Escuelas (Tenants)
// Endpoints bajo /api/schools. Acceso restringido a super_admin.
const express = require("express");
const {
  getAllSchools,
  createSchool,
  createSchoolWithLogo,
  getSchoolById,
  updateSchool,
  deleteSchool,
  uploadSchoolLogo,
  deleteSchoolLogo,
  getSchoolLogoVersions,
  rollbackSchoolLogo,
} = require("../controllers/schools.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const { uploadSingle } = require("../middleware/upload.middleware");

const { Router } = express;
const router = Router();

// Todas las rutas requieren JWT + super_admin
router.use(isAuthenticated);
router.use(authorize("super_admin"));

// GET /api/schools — listar todos los tenants
router.get("/", getAllSchools);

// POST /api/schools — dar de alta un nuevo tenant (JSON, sin logo)
router.post("/", createSchool);

// POST /api/schools/with-logo — crear escuela + subir logo en un solo request
// (multipart/form-data). Va antes de /:schoolId para que Express no matchee
// "with-logo" como un ObjectId.
router.post("/with-logo", uploadSingle("logo"), createSchoolWithLogo);

// GET /api/schools/:schoolId — detalle
router.get("/:schoolId", getSchoolById);

// PUT /api/schools/:schoolId — actualizar SOLO name/isActive.
// Para cambiar el logo usar POST /api/schools/:schoolId/logo o DELETE.
router.put("/:schoolId", updateSchool);

// DELETE /api/schools/:schoolId — eliminar (bloqueado si hay datos asociados)
router.delete("/:schoolId", deleteSchool);

// Rutas con path explícito "logo/..." — DEBEN ir antes que /:schoolId
// para que Express no matchee esos segmentos como un ObjectId.
router.post("/:schoolId/logo", uploadSingle("logo"), uploadSchoolLogo);
router.delete("/:schoolId/logo", deleteSchoolLogo);
router.get("/:schoolId/logo/versions", getSchoolLogoVersions);
router.post("/:schoolId/logo/rollback", rollbackSchoolLogo);

module.exports = router;
