// Router de Escuelas (Tenants)
// Endpoints bajo /api/schools. Acceso restringido a super_admin.
const express = require("express");
const {
  getAllSchools,
  createSchool,
  getSchoolById,
  updateSchool,
  deleteSchool,
} = require("../controllers/schools.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const { Router } = express;
const router = Router();

// Todas las rutas requieren JWT + super_admin
router.use(isAuthenticated);
router.use(authorize("super_admin"));

// GET /api/schools — listar todos los tenants
router.get("/", getAllSchools);

// POST /api/schools — dar de alta un nuevo tenant
router.post("/", createSchool);

// GET /api/schools/:schoolId — detalle
router.get("/:schoolId", getSchoolById);

// PUT /api/schools/:schoolId — actualizar (nombre, logo, isActive, etc.)
router.put("/:schoolId", updateSchool);

// DELETE /api/schools/:schoolId — eliminar (bloqueado si hay datos asociados)
router.delete("/:schoolId", deleteSchool);

module.exports = router;
