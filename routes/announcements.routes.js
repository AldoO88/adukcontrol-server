// Router de Announcements (Avisos)
// CRUD staff bajo /api/announcements. Los tutores NO usan estas rutas:
// consumen los avisos vía el feed unificado /api/guardians/me/announcements.
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  createAnnouncement,
  getAllAnnouncements,
  getAnnouncementById,
  updateAnnouncement,
  deleteAnnouncement,
  REPORTER_ROLES,
} = require("../controllers/announcements.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

// Cualquier staff con permiso puede listar / ver detalle.
// (Los tutores quedan fuera de este authorize; consumen vía /me/announcements).
const STAFF_ROLES = [
  "admin",
  "principal",
  "registrar",
  "teacher",
  "prefect",
  "social_worker",
  "super_admin",
];

// POST /api/announcements — crear (staff con permiso; teacher con alcance)
router.post("/", authorize(...REPORTER_ROLES), createAnnouncement);

// GET /api/announcements — listar (staff)
router.get("/", authorize(...STAFF_ROLES), getAllAnnouncements);

// GET /api/announcements/:id — detalle
router.get("/:id", authorize(...STAFF_ROLES), getAnnouncementById);

// PUT /api/announcements/:id — editar (sender o admin, validado en controller)
router.put("/:id", authorize(...STAFF_ROLES), updateAnnouncement);

// DELETE /api/announcements/:id — borrar (sender o admin, validado en controller)
router.delete("/:id", authorize(...STAFF_ROLES), deleteAnnouncement);

module.exports = router;
