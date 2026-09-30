// Punto de entrada de la aplicación Express.
// Construye la app con todos sus middlewares y rutas, y la exporta.
// El listener HTTP y el manejo de señales de cierre viven en server.js.
require("dotenv").config(); // Cargar variables de entorno desde .env

require("./db"); // Iniciar conexión a MongoDB al importar

// ---------------------------------------------------------------------
// OTP_ECHO warning: si la var está activa, loguear un banner bien visible
// al arrancar para que sea imposible olvidar que el código sale en logs
// (no se está enviando WhatsApp real). Ver services/whatsapp.service.js.
// ---------------------------------------------------------------------
{
  const v = process.env.OTP_ECHO;
  const enabled =
    !!v &&
    ["1", "true", "console", "yes", "on"].includes(String(v).toLowerCase());
  if (enabled) {
    console.warn(
      "==================================================================="
    );
    console.warn(
      ` [otp-echo] OTP_ECHO=${v} ACTIVO — WhatsApp DESHABILITADO.`
    );
    console.warn(
      " Los códigos de activación / recuperación se imprimen en logs"
    );
    console.warn(
      " del servidor en lugar de enviarse por WhatsApp. NO dejar activo"
    );
    console.warn(
      " en producción con usuarios reales."
    );
    console.warn(
      "==================================================================="
    );
  }
}

// Nota: las notificaciones push ahora usan Expo Push API (HTTP).
// No se requiere inicialización de Firebase Admin SDK al arranque —
// el módulo services/notification.service.js funciona on-demand.

const express = require("express");

const app = express();

// Health check: útil para balanceadores y para verificar que el server responde
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "eduk-control-backend",
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Banner de la raíz para identificar el servicio al hacer GET /
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Eduk Control Backend API is running.",
    version: "1.0.0",
    docs: "/api",
  });
});

require("./config")(app); // Middlewares globales (CORS, helmet, parsers, logger, etc.)

const indexRoutes = require("./routes/index.routes");
const authRouter = require("./routes/auth.routes");
const authWebhooksRouter = require("./routes/auth-webhooks.routes");
const admsRouter = require("./routes/adms.routes");
const hikvisionRouter = require("./routes/hikvision.routes");

app.use("/api", indexRoutes); // /api/students, /api/attendance, /api/groups, /api/enrollments
app.use("/auth", authRouter); // /auth/signup, /auth/login, /auth/verify
app.use("/auth/webhooks", authWebhooksRouter); // /auth/webhooks/twilio/...
// /iclock/* — push de las terminales ZKTeco (ADMS). Va fuera de /api porque
// la ruta está fija en el firmware del dispositivo y no es configurable.
app.use("/iclock", admsRouter);
// /hikvision/event/<token> — push HTTP Listening de las terminales Hikvision
// (ISAPI httpHosts). La URL completa la elegimos nosotros (la escribimos en
// el form "HTTP Listening" de la UI de la terminal), así que el path vive
// fuera de /api pero no está atado al firmware.
app.use("/hikvision", hikvisionRouter);

require("./error-handling")(app); // 404 + manejador central de errores

module.exports = app;
