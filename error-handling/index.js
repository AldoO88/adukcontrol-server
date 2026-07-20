// Manejo de errores y 404
// Se monta al final del pipeline de middlewares de Express.
// Captura errores de Mongoose (validación, cast, duplicados) y los traduce
// a respuestas HTTP legibles.
module.exports = (app) => {
  // 404: cualquier ruta que no haya coincidido con un router llega aquí
  app.use((req, res, next) => {
    res.status(404).json({ message: "This route does not exist" });
  });

  // Manejador central de errores
  app.use((err, req, res, next) => {
    // Loggear siempre para diagnóstico
    console.error("ERROR", req.method, req.path, err);

    // Error de validación de Mongoose: juntar todos los mensajes
    if (err && err.name === "ValidationError") {
      const messages = Object.values(err.errors || {}).map((e) => e.message);
      if (!res.headersSent) {
        return res.status(400).json({ message: messages.join(". ") });
      }
    }

    // Error de clave duplicada (MongoDB error 11000)
    if (err && err.code === 11000) {
      const value = err.keyValue ? JSON.stringify(err.keyValue) : "duplicate value";
      if (!res.headersSent) {
        return res
          .status(409)
          .json({ message: `Duplicate field value: ${value}. Please use another value.` });
      }
    }

    // Cast inválido (típicamente un ObjectId mal formado en un parámetro)
    if (err && err.name === "CastError") {
      if (!res.headersSent) {
        return res
          .status(400)
          .json({ message: `Invalid value for field '${err.path}'.` });
      }
    }

    // Render de respaldo: nunca enviar un 500 sin cuerpo
    if (!res.headersSent) {
      res.status(err.status || 500).json({
        // Para errores 4xx, mostrar el mensaje del error (puede ser de Mongoose/AppError)
        // Para 5xx, no filtrar detalles internos al cliente
        message:
          err.status && err.status < 500
            ? err.message
            : "Internal server error. Check the server console",
      });
    }
  });
};
