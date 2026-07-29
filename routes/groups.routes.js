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
} = require("../controllers/groups.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// GET /api/groups — listar todos los grupos (con filtros opcionales school_year_id, grade, section)
router.get(
  "/",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getAllGroups
);

// POST /api/groups — crear un grupo
router.post("/", authorize("admin", "registrar"), createGroup);

// GET /api/groups/:groupId/students — DEBE ir antes que /:groupId
router.get(
  "/:groupId/students",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getGroupStudents
);

// GET /api/groups/:groupId — detalle de un grupo
router.get(
  "/:groupId",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getGroupById
);

// PUT /api/groups/:groupId — actualizar un grupo
router.put(
  "/:groupId",
  authorize("admin", "registrar"),
  updateGroup
);

// DELETE /api/groups/:groupId — eliminar un grupo
router.delete(
  "/:groupId",
  authorize("admin", "registrar"),
  deleteGroup
);

module.exports = router;
