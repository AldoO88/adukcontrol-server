// Punto de entrada de la aplicación Express.
// Construye la app con todos sus middlewares y rutas, y la exporta.
// El listener HTTP y el manejo de señales de cierre viven en server.js.
require("dotenv").config(); // Cargar variables de entorno desde .env

require("./db"); // Iniciar conexión a MongoDB al importar

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

app.use("/api", indexRoutes); // /api/students, /api/attendance, /api/groups, /api/enrollments
app.use("/auth", authRouter); // /auth/signup, /auth/login, /auth/verify
app.use("/auth/webhooks", authWebhooksRouter); // /auth/webhooks/twilio/...
// /iclock/* — push de las terminales ZKTeco (ADMS). Va fuera de /api porque
// la ruta está fija en el firmware del dispositivo y no es configurable.
app.use("/iclock", admsRouter);

require("./error-handling")(app); // 404 + manejador central de errores

module.exports = app;
