// Router de Configuración de Conducta (ConductConfig)
// Un único documento por escuela. Si nunca se creó, el sistema usa defaults.
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  getConfig,
  upsertConfig,
} = require("../controllers/conduct-config.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// GET /api/conduct-config — cualquier miembro del staff puede ver
router.get(
  "/",
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"),
  getConfig
);

// PUT /api/conduct-config — solo admin/registrar/super_admin pueden modificar
router.put(
  "/",
  authorize("admin", "registrar", "super_admin"),
  upsertConfig
);

module.exports = router;
