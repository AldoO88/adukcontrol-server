const app = require("./app"); // Instancia de Express

const PORT = process.env.PORT || 5000; // Puerto desde env o valor por defecto

const server = app.listen(PORT, () => { // Iniciar listener HTTP
  console.log(`Server listening on http://localhost:${PORT}`); // Log de arranque
});

const shutdown = (signal) => { // Manejador de cierre limpio
  console.log(`\n${signal} received. Closing server gracefully...`); // Log de señal recibida
  server.close(async () => { // Dejar de aceptar conexiones nuevas
    try {
      const mongoose = require("mongoose"); // Require perezoso
      await mongoose.connection.close(); // Cerrar pool de Mongo
      console.log("MongoDB connection closed."); // Confirmar cierre
      process.exit(0); // Salida limpia
    } catch (err) {
      console.error(`Error during shutdown: ${err.message}`); // Log de error
      process.exit(1); // Salida con error
    }
  });
  setTimeout(() => { // Timeout duro de respaldo
    console.error("Forcing shutdown after timeout."); // Forzar cierre
    process.exit(1); // Salida forzada
  }, 10000).unref(); // 10 segundos, no mantiene el loop vivo
};

process.on("SIGTERM", () => shutdown("SIGTERM")); // Señal de terminación
process.on("SIGINT", () => shutdown("SIGINT")); // Señal de Ctrl+C

process.on("uncaughtException", (err) => { // Capturar excepciones síncronas
  console.error("UNCAUGHT EXCEPTION:", err); // Registrar el error
  shutdown("uncaughtException"); // Cerrar el servidor
});

process.on("unhandledRejection", (reason) => { // Capturar rechazos de promesas
  console.error("UNHANDLED REJECTION:", reason); // Registrar el rechazo
});
