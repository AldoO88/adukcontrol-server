// Router de Citation (Citatorio)
// CRUD staff bajo /api/citations. Los tutores NO usan estas rutas:
// consumen los citatorios vía el feed unificado /api/guardians/me/announcements
// (mezclados con los avisos).
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  createCitation,
  getAllCitations,
  getCitationById,
  updateCitationStatus,
  deleteCitation,
  getMyCitations,
  rescheduleCitation,
  updateCitation,
  cancelCitation,
  REPORTER_ROLES,
  STAFF_ROLES,
} = require("../controllers/citations.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// POST /api/citations — crear (staff con permiso; teacher con alcance)
router.post("/", authorize(...REPORTER_ROLES), createCitation);

// GET /api/citations/me — citatorios creados por el maestro logueado
router.get("/me", authorize(...STAFF_ROLES), getMyCitations);

// GET /api/citations — listar (staff)
router.get("/", authorize(...STAFF_ROLES), getAllCitations);

// GET /api/citations/:id — detalle
router.get("/:id", authorize(...STAFF_ROLES), getCitationById);

// PUT /api/citations/:id — actualizar campos (creator o admin)
router.put("/:id", authorize(...REPORTER_ROLES), updateCitation);

// PATCH /api/citations/:id/status — cambiar status (cualquier staff)
router.patch(
  "/:id/status",
  authorize(...STAFF_ROLES),
  updateCitationStatus
);

// PATCH /api/citations/:id/reschedule — reagendar (creator o admin)
router.patch(
  "/:id/reschedule",
  authorize(...REPORTER_ROLES),
  rescheduleCitation
);

// PATCH /api/citations/:id/cancel — cancelar (creator o admin)
router.patch(
  "/:id/cancel",
  authorize(...REPORTER_ROLES),
  cancelCitation
);

// DELETE /api/citations/:id — borrado físico (solo super_admin)
router.delete("/:id", authorize("super_admin"), deleteCitation);

module.exports = router;
