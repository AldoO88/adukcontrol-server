// Router de webhooks relacionados a auth/OTP.
// Hoy soporta:
//   - POST /auth/webhooks/twilio/whatsapp-status
//     Twilio manda un POST form-encoded cuando un WhatsApp cambia de
//     estado (sent/delivered/read/failed/undelivered).
//
// NO requiere JWT: Twilio no puede hacer login, valida por URL secreta
// (la URL se mantiene privada en Twilio Console).
const express = require("express");
const { Router } = express;
const router = Router();

const { twilioStatusWebhook } = require("../controllers/webhooks.controller");

// Twilio manda application/x-www-form-urlencoded por default.
// express.urlencoded() está habilitado globalmente en config/index.js,
// así que req.body ya viene parseado.

// GET — health check
router.get("/twilio/whatsapp-status", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Twilio WhatsApp status webhook endpoint is reachable.",
  });
});

// POST — callback real
router.post("/twilio/whatsapp-status", twilioStatusWebhook);

module.exports = router;
