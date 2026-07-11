const express = require("express"); // Express (solo para tipos)
const logger = require("morgan"); // Logger de peticiones HTTP
const cookieParser = require("cookie-parser"); // Parser de cookies
const cors = require("cors"); // Middleware CORS
const helmet = require("helmet"); // Cabeceras de seguridad
const mongoSanitize = require("express-mongo-sanitize"); // Sanitizar claves $ y .
const hpp = require("hpp"); // Prevenir pollution de parámetros

const FRONTEND_URL = process.env.ORIGIN || "http://localhost:5173"; // Origen permitido

module.exports = (app) => { // Exporta una función de configuración
  app.set("trust proxy", 1); // Confiar en X-Forwarded-For de un único proxy

  app.use( // Configurar CORS
    cors({
      origin: process.env.ORIGIN || FRONTEND_URL, // Origen permitido
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], // Métodos permitidos
      allowedHeaders: ["Content-Type", "Authorization"], // Cabeceras permitidas
      credentials: true, // Permitir cookies
    })
  );

  app.use(helmet()); // Cabeceras de seguridad por defecto
  app.use(mongoSanitize()); // Sanitizar body/query/params
  app.use(hpp()); // Prevenir HTTP parameter pollution

  if (process.env.NODE_ENV !== "test") { // Omitir logs en pruebas
    app.use(logger(process.env.NODE_ENV === "production" ? "combined" : "dev")); // Logger HTTP
  }

  app.use(express.json({ limit: "1mb" })); // Parser de cuerpo JSON (1MB)
  app.use(express.urlencoded({ extended: false, limit: "1mb" })); // Parser de formularios
  app.use(cookieParser()); // Parser de cookies
};
