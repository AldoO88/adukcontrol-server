module.exports = (app) => { // Función exportada de cableado
  app.use((req, res, next) => { // Catch-all 404
    res.status(404).json({ message: "This route does not exist" }); // Respuesta 404
  });

  app.use((err, req, res, next) => { // Manejador central de errores
    console.error("ERROR", req.method, req.path, err); // Registrar siempre

    if (err && err.name === "ValidationError") { // Validación de Mongoose
      const messages = Object.values(err.errors || {}).map((e) => e.message); // Aplanar mensajes
      if (!res.headersSent) { // Si aún no se respondió
        return res.status(400).json({ message: messages.join(". ") }); // 400 con mensajes
      }
    }

    if (err && err.code === 11000) { // Clave duplicada
      const value = err.keyValue ? JSON.stringify(err.keyValue) : "duplicate value"; // Detalle
      if (!res.headersSent) { // Si aún no se respondió
        return res // 409 conflicto
          .status(409)
          .json({ message: `Duplicate field value: ${value}. Please use another value.` });
      }
    }

    if (err && err.name === "CastError") { // Cast inválido (ObjectId mal formado)
      if (!res.headersSent) { // Si aún no se respondió
        return res // 400
          .status(400)
          .json({ message: `Invalid value for field '${err.path}'.` });
      }
    }

    if (!res.headersSent) { // Render de respaldo
      res.status(err.status || 500).json({ // Código de estado
        message: // Mensaje humano
          err.status && err.status < 500
            ? err.message
            : "Internal server error. Check the server console",
      });
    }
  });
};
