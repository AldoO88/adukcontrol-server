// Router de Uploads
//   - GET  /api/uploads/events   — Server-Sent Events para notificar al
//                                   cliente cuando un retry asíncrono termina
//   - POST /api/uploads/retry    — Reintentar manualmente un upload que
//                                   quedó pendiente (sin esperar al cron)
//
// Las rutas usan el middleware isAuthenticated porque el cliente envía
// el JWT en la query (los EventSource del navegador no permiten headers).
const express = require("express");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const User = require("../models/User.model");
const School = require("../models/School.model");
const Student = require("../models/Student.model");
const AssetVersion = require("../models/AssetVersion.model");
const {
  uploadFileOnce,
  saveForRetry,
  s3Storage,
  PENDING_DIR,
} = require("../services/cloudinary-upload.service");
const {
  addSubscriber,
  removeSubscriber,
  startKeepalive,
} = require("../services/sse.service");

const { Router } = express;
const router = Router();

// Rate limiter para el endpoint de retry manual: 10 por minuto por user.
// Evita que un admin con token válido spamee Cloudinary con reintentos.
const retryRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `retry:${req.payload._id}`, // por user, no por IP
  message: { message: "Too many retry requests. Please slow down." },
});

// Middleware de auth para el SSE endpoint.
// Acepta el JWT desde (en orden de prioridad):
//   1. Query string: ?token=<jwt>  (compatibilidad con EventSource del browser)
//   2. Header Authorization: Bearer <jwt>  (para clientes no-browser)
//   3. Cookie HttpOnly: "token"  (para flujos con cookie de sesión)
//
// Los EventSource del navegador NO permiten enviar headers personalizados,
// por eso se necesita query string. La opción cookie es una alternativa
// más segura (no expone el token en URLs/logs) si el front usa cookies.
const authenticateForSSE = async (req, res, next) => {
  try {
    // 1. Query string
    let token = req.query.token;

    // 2. Authorization header
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(" ");
      if (parts[0] === "Bearer" && parts[1]) token = parts[1];
    }

    // 3. HttpOnly cookie "token"
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res
        .status(401)
        .json({ message: "Missing token (query, header, or cookie)." });
    }

    const decoded = jwt.verify(token, process.env.SECRET_KEY, {
      algorithms: ["HS256"],
    });
    req.payload = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid or expired token." });
  }
};

// GET /api/uploads/events
// Server-Sent Events stream. El cliente se conecta con:
//   new EventSource("/api/uploads/events?token=" + jwt);
// Auth via query string (limitación de EventSource).
router.get("/events", authenticateForSSE, (req, res) => {
  const userId = String(req.payload._id);

  // Configurar headers SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx: no buffering

  // Mensaje inicial para que el cliente sepa que está conectado
  res.write(`event: connected\ndata: ${JSON.stringify({ user_id: userId })}\n\n`);

  addSubscriber(userId, res);
  const keepalive = startKeepalive(res);

  // Limpiar al cerrar
  const cleanup = () => {
    clearInterval(keepalive);
    removeSubscriber(userId, res);
  };
  req.on("close", cleanup);
  req.on("aborted", cleanup);
});

// POST /api/uploads/retry
// Reintenta manualmente un upload pendiente. Toma entity_type y entity_id
// desde el body, busca el .bin correspondiente en PENDING_DIR y reintenta.
//
// Body: { entity_type: "school" | "student", entity_id: "<id>" }
// Auth: admin/registrar/super_admin (es staff operation)
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const retryUpload = async (req, res, next) => {
  try {
    const { entity_type, entity_id } = req.body;
    if (!["school", "student"].includes(entity_type)) {
      return res
        .status(400)
        .json({ message: "entity_type must be 'school' or 'student'." });
    }
    if (!entity_id) {
      return res.status(400).json({ message: "entity_id is required." });
    }

    // Buscar el archivo .bin más reciente para este entity
    // (puede haber varios si hubo múltiples fallos)
    const prefix = `${entity_type === "school" ? "school" : "student"}_${entity_id}`;
    const files = fs
      .readdirSync(PENDING_DIR)
      .filter((f) => f.endsWith(".bin"))
      .map((f) => ({
        filePath: path.join(PENDING_DIR, f),
        sidecarPath: path.join(PENDING_DIR, f.replace(".bin", ".json")),
        stat: fs.statSync(path.join(PENDING_DIR, f)),
      }))
      .filter((entry) => {
        // El sidecar debe tener el entity_id en metadata
        if (!fs.existsSync(entry.sidecarPath)) return false;
        try {
          const sidecar = JSON.parse(fs.readFileSync(entry.sidecarPath, "utf8"));
          return sidecar.metadata && sidecar.metadata.entity_id === entity_id;
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs); // más reciente primero

    if (files.length === 0) {
      return res.status(404).json({
        message: `No pending upload found for ${entity_type} ${entity_id}.`,
      });
    }

    const { filePath, sidecarPath } = files[0];
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));

    // Reintentar upload
    try {
      const result = await uploadFileOnce(filePath, sidecar.uploadOptions);

      // Borrar archivos
      fs.unlinkSync(filePath);
      if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);

      // Actualizar la DB igual que en el controller normal
      if (entity_type === "school") {
        const school = await School.findById(entity_id);
        if (school) {
          school.logoUrl = result.secure_url;
          await school.save();
          await AssetVersion.updateMany(
            { entity_type: "school", entity_id, is_current: true },
            { $set: { is_current: false } }
          );
          await AssetVersion.create({
            entity_type: "school",
            entity_id,
            public_id: result.public_id,
            url: result.secure_url,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
            is_current: true,
            uploaded_by: sidecar.metadata?.uploaded_by || null,
          });
        }
      } else {
        const student = await Student.findById(entity_id);
        if (student) {
          student.photoUrl = result.secure_url;
          await student.save();
          await AssetVersion.updateMany(
            { entity_type: "student", entity_id, is_current: true },
            { $set: { is_current: false } }
          );
          await AssetVersion.create({
            entity_type: "student",
            entity_id,
            public_id: result.public_id,
            url: result.secure_url,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
            is_current: true,
            uploaded_by: sidecar.metadata?.uploaded_by || null,
          });
        }
      }

      res.status(200).json({
        message: "Retry succeeded.",
        result: {
          url: result.secure_url,
          public_id: result.public_id,
        },
      });
    } catch (err) {
      // Sigue fallando, dejar el archivo para próximo run
      res.status(502).json({
        message: `Retry still failing: ${err.message}`,
        will_retry: true,
      });
    }
  } catch (error) {
    next(error);
  }
};

// Aplica auth estándar a /retry (los SSE events usan el custom middleware)
router.post(
  "/retry",
  isAuthenticated,
  authorize("admin", "registrar", "super_admin"),
  retryRateLimiter,
  retryUpload
);

module.exports = router;
