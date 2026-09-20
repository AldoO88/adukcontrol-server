// =====================================================================
// controllers/notifications.controller.js
// =====================================================================
// Endpoints para la campanita in-app:
//
//   GET    /api/me/notifications          → lista de notificaciones
//   GET    /api/me/notifications/unread-count → contador
//   PATCH  /api/me/notifications/:id/read → marcar una como leída
//   PATCH  /api/me/notifications/read-all → marcar todas como leídas
//
// Todos requieren JWT (el user_id viene del token, nunca del body).
// Todos filtran por school (tenant scoping) — un usuario solo ve sus
// propias notificaciones de su escuela.
// =====================================================================
const notificationsService = require("../services/notifications.service");

// GET /api/me/notifications
// Query params:
//   unread=true   → solo no leídas
//   limit=50       → max 100 (default 50)
const getMyNotifications = async (req, res, next) => {
  try {
    const userId = req.payload._id;
    const schoolId = req.payload.schoolId;

    if (!userId || !schoolId) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const unreadOnly = req.query.unread === "true";
    const limit = parseInt(req.query.limit, 10) || 50;

    const notifications = await notificationsService.getMyNotifications(
      userId,
      schoolId,
      { unreadOnly, limit },
    );

    res.status(200).json({ notifications });
  } catch (error) {
    next(error);
  }
};

// GET /api/me/notifications/unread-count
const getUnreadCount = async (req, res, next) => {
  try {
    const userId = req.payload._id;
    const schoolId = req.payload.schoolId;

    if (!userId || !schoolId) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const count = await notificationsService.getUnreadCount(userId, schoolId);

    res.status(200).json({ count });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/me/notifications/:id/read
const markAsRead = async (req, res, next) => {
  try {
    const userId = req.payload._id;
    const schoolId = req.payload.schoolId;
    const { id } = req.params;

    if (!userId || !schoolId) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const updated = await notificationsService.markAsRead(id, userId, schoolId);

    if (!updated) {
      // 404 si no existe O si pertenece a otro user/otro school
      // (tenant isolation: no leak info about other tenants).
      return res.status(404).json({
        message: "Notification not found or not owned by this user.",
      });
    }

    res.status(200).json({
      message: "Notification marked as read.",
      read_at: updated.read_at,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/me/notifications/read-all
const markAllAsRead = async (req, res, next) => {
  try {
    const userId = req.payload._id;
    const schoolId = req.payload.schoolId;

    if (!userId || !schoolId) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const marked = await notificationsService.markAllAsRead(userId, schoolId);

    res.status(200).json({
      message: "All notifications marked as read.",
      marked,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
};
