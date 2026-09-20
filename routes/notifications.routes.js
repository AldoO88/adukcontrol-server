// =====================================================================
// routes/notifications.routes.js
// =====================================================================
// Rutas para la campanita in-app:
//   GET    /api/me/notifications           → lista de notificaciones
//   GET    /api/me/notifications/unread-count → contador
//   PATCH  /api/me/notifications/:id/read  → marcar una como leída
//   PATCH  /api/me/notifications/read-all  → marcar todas como leídas
//
// Todas las rutas requieren JWT (isAuthenticated middleware).
// El user_id SIEMPRE viene del payload del JWT, nunca del body o
// query params — esto es lo que garantiza que un usuario solo pueda
// ver/modificar sus propias notificaciones.
// =====================================================================
const express = require("express");
const { Router } = express;
const router = Router();

const {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} = require("../controllers/notifications.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");

router.get("/me/notifications", isAuthenticated, getMyNotifications);
router.get("/me/notifications/unread-count", isAuthenticated, getUnreadCount);
router.patch("/me/notifications/read-all", isAuthenticated, markAllAsRead);
router.patch(
  "/me/notifications/:id/read",
  isAuthenticated,
  markAsRead,
);

module.exports = router;
