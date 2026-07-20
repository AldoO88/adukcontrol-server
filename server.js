// Punto de entrada del servidor.
// Levanta el listener HTTP, registra los manejadores de señales
// (SIGTERM, SIGINT, uncaughtException) y gestiona el cierre limpio.
const app = require("./app"); // Instancia de Express ya configurada

const PORT = process.env.PORT || 5005;

const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// Cierre limpio: dejar de aceptar conexiones, cerrar pool de Mongo, salir.
const shutdown = (signal) => {
  console.log(`\n${signal} received. Closing server gracefully...`);
  server.close(async () => {
    try {
      const mongoose = require("mongoose");
      await mongoose.connection.close();
      console.log("MongoDB connection closed.");
      process.exit(0);
    } catch (err) {
      console.error(`Error during shutdown: ${err.message}`);
      process.exit(1);
    }
  });
  // Timeout duro de respaldo: si el cierre limpio tarda demasiado, forzar
  setTimeout(() => {
    console.error("Forcing shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Capturar excepciones síncronas no manejadas
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  shutdown("uncaughtException");
});

// Capturar rechazos de promesas no manejados (solo se loggean, no se cierra)
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
