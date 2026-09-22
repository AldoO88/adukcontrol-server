// Router de Plantillas de Turno (ShiftTemplate)
// CRUD bajo /api/shift-templates.
const express = require("express");
const {
  getAllTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = require("../controllers/shift-templates.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

const readRoles = ["admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"];
const writeRoles = ["admin", "registrar", "super_admin"];

router.get("/", authorize(...readRoles), getAllTemplates);
router.post("/", authorize(...writeRoles), createTemplate);
router.get("/:templateId", authorize(...readRoles), getTemplateById);
router.put("/:templateId", authorize(...writeRoles), updateTemplate);
router.delete("/:templateId", authorize(...writeRoles), deleteTemplate);

module.exports = router;
