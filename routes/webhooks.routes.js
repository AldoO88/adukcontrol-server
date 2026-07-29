// Webhook de Cloudinary
// Recibe notificaciones que Cloudinary envía cuando:
//   - Un upload asíncrono (eager_async) se completa
//   - Un upload falla
//   - Un asset se procesa (eager transformations)
//
// Cloudinary envía un POST con el siguiente payload típico:
//   {
//     "notification_type": "upload",
//     "public_id": "edukcontrol/schools/logos/school_65a1b...",
//     "version": "1700000000",
//     "status": "fulfilled" | "failed",
//     "info": { ... },
//     "request_id": "abc123"
//   }
//
// Configuración: agregar la URL del webhook a las opciones de upload
// (`notification_url`) y `CLOUDINARY_WEBHOOK_SECRET` en .env para validar
// la firma `X-Cld-Signature` (HMAC-SHA256 del raw body + secret).
const express = require("express");
const crypto = require("crypto");

const { Router } = express;
const router = Router();

// Webhooks NO requieren JWT (Cloudinary no sabe hacer login).
// El router se monta FUERA de la cadena isAuthenticated.

// Verifica la firma del webhook contra CLOUDINARY_WEBHOOK_SECRET.
// Usa crypto.timingSafeEqual para evitar timing attacks.
// Si el secret no está configurado en el servidor, rechaza por seguridad.
const verifyCloudinarySignature = (req) => {
  const secret = process.env.CLOUDINARY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn(
      "[cloudinary-webhook] CLOUDINARY_WEBHOOK_SECRET is not set; rejecting all webhooks."
    );
    return false;
  }
  const signature = req.headers["x-cld-signature"];
  if (!signature) return false;
  if (!req.rawBody) return false; // El parser debe haber capturado el body crudo

  const expected = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("hex");

  const sigBuf = Buffer.from(String(signature), "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
};

// POST /api/webhooks/cloudinary
// Body: ver docs https://cloudinary.com/documentation/notifications
router.post("/cloudinary", (req, res) => {
  // Validar firma PRIMERO. Si falla, responder 401 sin procesar nada.
  if (!verifyCloudinarySignature(req)) {
    console.warn(
      "[cloudinary-webhook] Invalid or missing signature. Rejecting."
    );
    return res.status(401).json({ message: "Invalid signature." });
  }

  // Cloudinary espera 200 rápido. Procesamos async después de responder.
  res.status(200).json({ received: true });

  // Parsear el body manualmente (el parser global ya lo hizo, está en req.body)
  const body = req.body || {};
  const { notification_type, public_id, version, status, info, request_id } =
    body;

  console.log(
    `[cloudinary-webhook] type=${notification_type} status=${status} public_id=${public_id} version=${version} request_id=${request_id}`
  );

  if (status === "failed") {
    console.error(
      `[cloudinary-webhook] Upload FAILED for ${public_id}:`,
      info || body
    );
    // Aquí iría la lógica de remediación: actualizar el AssetVersion
    // correspondiente con un campo `status: 'failed'`, notificar al admin,
    // reintentar via scripts/retry-pending-uploads.js, etc.
    return;
  }

  if (status === "fulfilled") {
    // Eager transformations completadas, etc. No requiere acción por ahora.
    return;
  }

  // Otros status: pending, partially_applied, etc. Loggear sin acción.
});

// GET /api/webhooks/cloudinary — health check (Cloudinary puede hacer GET
// para verificar que la URL responde)
router.get("/cloudinary", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Cloudinary webhook endpoint is reachable.",
  });
});

module.exports = router;
