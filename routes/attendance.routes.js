const express = require("express"); // Módulo Express
const rateLimit = require("express-rate-limit"); // Middleware de rate limiting
const { // Controladores
  deviceTriggerController,
  getAttendanceLogsController,
} = require("../controllers/attendance.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware"); // Middleware JWT
const { authorize } = require("../middleware/authorize.middleware"); // Middleware de roles
const { verifyDeviceApiKey } = require("../middleware/device.middleware"); // Auth de dispositivo

const { Router } = express; // Desestructurar Router
const router = Router(); // Construir sub-router

const deviceLimiter = rateLimit({ // Limitador más estricto para hardware
  windowMs: 1 * 60 * 1000, // Ventana de 1 minuto
  max: 300, // 300 solicitudes por minuto
  standardHeaders: true, // Cabeceras RateLimit-*
  legacyHeaders: false, // Sin X-RateLimit-*
  message: { message: "Too many device requests, please slow down." }, // Cuerpo 429
});

router.post( // POST /api/attendance/device-trigger
  "/device-trigger",
  deviceLimiter, // Throttling
  verifyDeviceApiKey, // Verificación de API key
  deviceTriggerController // Manejador
);

router.get( // GET /api/attendance/logs
  "/logs",
  isAuthenticated, // Requiere JWT
  authorize("admin", "control_escolar", "maestro", "prefecto"), // Cualquier personal
  getAttendanceLogsController // Manejador
);

module.exports = router; // Exportar
