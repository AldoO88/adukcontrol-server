// Configuración global de Express
// Monta middlewares de seguridad, parsers, CORS y logger.
// Es una función que recibe la app de Express y la muta con el middleware.
const express = require("express");
const logger = require("morgan"); // Logger de peticiones HTTP
const cookieParser = require("cookie-parser"); // Parser de cookies
const cors = require("cors"); // Middleware CORS
const helmet = require("helmet"); // Cabeceras de seguridad
const mongoSanitize = require("express-mongo-sanitize"); // Sanitiza claves $ y .
const hpp = require("hpp"); // Previene HTTP parameter pollution

const FRONTEND_URL = process.env.ORIGIN || "http://localhost:5173"; // Origen del frontend

module.exports = (app) => {
  // Confiar en X-Forwarded-For de un único proxy (importante para que
  // express-rate-limit identifique correctamente la IP del cliente).
  app.set("trust proxy", 1);

  // CORS: permitir el frontend configurado, con credenciales
  app.use(
    cors({
      origin: process.env.ORIGIN || FRONTEND_URL,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  );

  // Cabeceras de seguridad por defecto
  app.use(helmet());

  // Sanitizar body/query/params para evitar inyección de operadores de Mongo
  app.use(mongoSanitize());

  // Prevenir HTTP parameter pollution (por ejemplo, ?status=a&status=b)
  app.use(hpp());

  // Logger HTTP solo fuera de tests
  if (process.env.NODE_ENV !== "test") {
    app.use(logger(process.env.NODE_ENV === "production" ? "combined" : "dev"));
  }

  // Parsers de cuerpo: JSON y urlencoded, con límite de 1MB
  // El callback `verify` captura el body crudo (Buffer) en req.rawBody
  // para que rutas como el webhook de Cloudinary puedan verificar la firma.
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(
    express.urlencoded({
      extended: false,
      limit: "1mb",
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Parser de cookies
  app.use(cookieParser());
};
