// Router de Grupos
// Endpoints bajo /api/groups. Todos requieren JWT.
// Escritura: admin o registrar. Lectura: cualquier rol del personal.
const express = require("express");
const {
  getAllGroups,
  createGroup,
  getGroupById,
  updateGroup,
  deleteGroup,
  getGroupStudents,
  getGroupSchedule,
} = require("../controllers/groups.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  attachSchoolContext,
  attachActiveSchoolYear,
} = require("../middleware/tenant-context.middleware");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// GET /api/groups — listar todos los grupos (con filtros opcionales school_year_id, grade, section)
router.get(
  "/",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getAllGroups
);

// POST /api/groups — crear un grupo
router.post("/", authorize("admin", "principal", "registrar"), createGroup);

// GET /api/groups/:groupId/students — DEBE ir antes que /:groupId
router.get(
  "/:groupId/students",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getGroupStudents
);

// GET /api/groups/:groupId/schedule — horario semanal del grupo
router.get(
  "/:groupId/schedule",
  attachSchoolContext,
  attachActiveSchoolYear,
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getGroupSchedule
);

// GET /api/groups/:groupId — detalle de un grupo
router.get(
  "/:groupId",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getGroupById
);

// PUT /api/groups/:groupId — actualizar un grupo
router.put(
  "/:groupId",
  authorize("admin", "principal", "registrar"),
  updateGroup
);

// DELETE /api/groups/:groupId — eliminar un grupo
router.delete(
  "/:groupId",
  authorize("admin", "principal", "registrar"),
  deleteGroup
);

module.exports = router;
