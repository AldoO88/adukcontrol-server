const express = require("express"); // Módulo Express
const { // Controladores
  getAllGroups,
  createGroup,
  getGroupById,
  updateGroup,
  deleteGroup,
} = require("../controllers/groups.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware"); // Middleware JWT
const { authorize } = require("../middleware/authorize.middleware"); // Middleware de roles

const { Router } = express; // Desestructurar Router
const router = Router(); // Construir sub-router

router.use(isAuthenticated); // Requerir JWT válido

router.get( // GET /api/groups
  "/",
  authorize("admin", "control_escolar", "maestro", "prefecto"), // Cualquier personal
  getAllGroups
);
router.post("/", authorize("admin", "control_escolar"), createGroup); // POST /api/groups
router.get( // GET /api/groups/:idGroup
  "/:idGroup",
  authorize("admin", "control_escolar", "maestro", "prefecto"), // Cualquier personal
  getGroupById
);
router.put( // PUT /api/groups/:idGroup
  "/:idGroup",
  authorize("admin", "control_escolar"), // Solo admin o control escolar
  updateGroup
);
router.delete( // DELETE /api/groups/:idGroup
  "/:idGroup",
  authorize("admin", "control_escolar"), // Solo admin o control escolar
  deleteGroup
);

module.exports = router; // Exportar
