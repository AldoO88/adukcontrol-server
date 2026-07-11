require("dotenv").config(); // Cargar variables de entorno desde .env

require("./db"); // Activar conexión a MongoDB

const notificationService = require("./services/notification.service"); // Wrapper de Firebase Admin
notificationService.initializeFirebase(); // Inicializar FCM al arrancar (no falla si no está configurado)

const cors = require("cors"); // Middleware CORS
const express = require("express"); // Framework Express

const app = express(); // Instancia de la aplicación

app.get("/health", (req, res) => { // Endpoint de health check
  res.status(200).json({ // Respuesta 200 OK
    success: true, // Bandera de éxito
    service: "eduk-control-backend", // Nombre del servicio
    status: "ok", // Estado del servicio
    uptime: process.uptime(), // Tiempo activo en segundos
    timestamp: new Date().toISOString(), // Marca de tiempo ISO actual
  });
});

app.get("/", (req, res) => { // Banner en la raíz
  res.status(200).json({ // Respuesta 200 OK
    message: "Eduk Control Backend API is running.", // Mensaje del banner
    version: "1.0.0", // Versión de la API
    docs: "/api", // Apuntador a documentación
  });
});

app.use( // CORS antes del resto de la configuración
  cors({
    origin: process.env.ORIGIN || "http://localhost:5173", // Origen permitido
    credentials: true, // Permitir envío de credenciales
  })
);

require("./config")(app); // Montar middleware global

const indexRoutes = require("./routes/index.routes"); // Agregador de rutas bajo /api
const authRouter = require("./routes/auth.routes"); // Rutas bajo /auth

app.use("/api", indexRoutes); // Montar rutas en /api
app.use("/auth", authRouter); // Montar rutas en /auth

require("./error-handling")(app); // Montar 404 y manejador de errores

module.exports = app; // Exportar para pruebas
