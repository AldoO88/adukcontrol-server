// Router de Asistencia
// Endpoints bajo /api/attendance.
// /device-trigger usa API key del dispositivo; el resto usa JWT.
const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  deviceTriggerController,
  getAttendanceLogsController,
} = require("../controllers/attendance.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const { verifyDeviceApiKey } = require("../middleware/device.middleware");

const { Router } = express;
const router = Router();

// Rate limiter más estricto para el endpoint de dispositivos:
// 300 peticiones por minuto por IP (los lectores pueden hacer polling).
const deviceLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // Ventana de 1 minuto
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many device requests, please slow down." },
});

// POST /api/attendance/device-trigger
// Lo consumen los lectores RFID/cámaras. Auth: API key del dispositivo.
router.post(
  "/device-trigger",
  deviceLimiter,
  verifyDeviceApiKey,
  deviceTriggerController
);

// GET /api/attendance/logs
// Consulta del historial. Auth: JWT + cualquier rol del personal.
router.get(
  "/logs",
  isAuthenticated,
  authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker"),
  getAttendanceLogsController
);

module.exports = router;
