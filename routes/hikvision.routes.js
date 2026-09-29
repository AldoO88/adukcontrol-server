// Router Hikvision (ISAPI HTTP Listening push)
// Se monta en /hikvision (fuera de /api): la ruta "/hikvision/event/<token>"
// se configura en la web UI de la terminal Hikvision bajo
//   System Configuration → HTTP(S) → HTTP Listening
// usando el dominio público del backend (ej. "adukcontrol-server.onrender.com").
//
// Auth: token opaco en el path (no en header) porque el firmware Hikvision
// NO permite añadir cabeceras personalizadas en el push. Se valida contra
// HIKVISION_EVENT_TOKEN con crypto.timingSafeEqual (mismo patrón que
// DEVICE_TRIGGER_API_KEY en middleware/device.middleware.js).
//
// Variables de entorno:
//   HIKVISION_EVENT_TOKEN  — token aleatorio de >= 32 chars. Se genera con
//                            `openssl rand -hex 32` y se pega en el campo
//                            "URL" del form HTTP Listening de la terminal.
//                            Sin este env, el endpoint rechaza todas las
//                            peticiones (401 text/plain).
//
// Regla dorada (misma que ADMS): siempre HTTP 200 con text/plain.
// Un 5xx hace que la terminal reenvíe el evento en loop hasta llenar su buffer.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { handleHikvisionEvent } = require("../controllers/hikvision.controller");

const { Router } = express;
const router = Router();

// Mismo window que ADMS pero ligeramente más bajo: el push Hikvision es
// event-driven (no polling), así que solo recibe punches reales.
const hikvisionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.type("text/plain").status(429).send("Too many requests"),
});

// La terminal empuja el cuerpo como XML (text/xml) o JSON (application/json)
// según el `parameterFormatType` configurado en el HTTP Listening. Algunos
// firmwares viejos llegan sin Content-Type. `type: () => true` los cubre
// todos como String a req.body (si express.json() no los parseó antes).
const hikvisionBodyParser = express.text({ type: () => true, limit: "1mb" });

router.use(hikvisionLimiter, hikvisionBodyParser);

// POST /hikvision/event/:token
// El :token se compara con HIKVISION_EVENT_TOKEN en el controller.
router.post("/event/:token", handleHikvisionEvent);

module.exports = router;
