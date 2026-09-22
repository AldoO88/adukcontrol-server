// Router de Plantillas de Grupo
// Endpoints bajo /api/group-templates. Todos requieren JWT.

const express = require("express");
const {
  getAllGroupTemplates,
  getGroupTemplateById,
  createGroupTemplate,
  updateGroupTemplate,
  deleteGroupTemplate,
} = require("../controllers/group-templates.controller");
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
const writeRoles = ["admin", "registrar", "super_admin"];

// GET /api/group-templates
router.get("/", authorize(...readRoles), getAllGroupTemplates);

// POST /api/group-templates
router.post("/", authorize(...writeRoles), createGroupTemplate);

// GET /api/group-templates/:templateId
router.get(
  "/:templateId",
  authorize(...readRoles),
  getGroupTemplateById
);

// PUT /api/group-templates/:templateId
router.put(
  "/:templateId",
  authorize(...writeRoles),
  updateGroupTemplate
);

// DELETE /api/group-templates/:templateId
router.delete(
  "/:templateId",
  authorize(...writeRoles),
  deleteGroupTemplate
);

module.exports = router;
