// Servicio de Upload a Cloudinary
// Encapsula la lógica de upload con:
//   - Reintentos adaptativos (clasificación del error: rate limit, 4xx, 5xx)
//   - Persistencia al fallar definitivamente, para que un job de cron
//     pueda reintentar más tarde (sobrevive reinicios del servidor)
//   - Backend de persistencia: disco local (default) o S3 (configurable)
//   - Generación del stream a partir de un buffer o de un path en disco
//
// Para usar:
//   const result = await uploadBufferWithRetry(buffer, uploadOptions);
//
// Si la subida falla tras todos los intentos, el caller puede llamar a
// `saveForRetry(buffer, options, error)` para dejar el archivo pendiente
// y que el job scripts/retry-pending-uploads.js lo procese.
const fs = require("fs");
const path = require("path");
const streamifier = require("streamifier");
const cloudinary = require("../config/cloudinary");
const s3Storage = require("./s3-storage.service");

const PENDING_DIR =
  process.env.PENDING_UPLOADS_DIR || "/tmp/eduk-pending-uploads";

// Si el backend es disco, asegurar que el directorio existe
if (!s3Storage.isEnabled() && !fs.existsSync(PENDING_DIR)) {
  fs.mkdirSync(PENDING_DIR, { recursive: true });
}

// Sube un buffer a Cloudinary vía upload_stream, envuelto en un Promise.
const uploadBufferOnce = (buffer, uploadOptions) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => (error ? reject(error) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });

// Sube un archivo en disco a Cloudinary usando createReadStream (más
// eficiente en memoria que cargar todo el archivo en RAM).
// Si el backend es S3, primero descarga el buffer desde S3 a memoria.
const uploadFileOnce = async (filePath, uploadOptions) => {
  let buffer;
  if (s3Storage.isEnabled()) {
    // filePath aquí es la key de S3 (sin el prefijo del bucket)
    buffer = await s3Storage.getBuffer(filePath);
  } else {
    buffer = fs.readFileSync(filePath);
  }
  return uploadBufferOnce(buffer, uploadOptions);
};

// Clasifica un error de Cloudinary o de red para decidir la estrategia de retry.
// Devuelve { shouldRetry, reason, multiplier }.
//
// Reglas:
//   - 429 / "Rate exceeded"      → reintentar, backoff largo (multiplier 30x)
//   - ENOTFOUND / EAI_AGAIN      → DNS issue, reintentar largo (multiplier 20x)
//   - ECONNREFUSED                → server down, reintentar largo (multiplier 20x)
//   - ETIMEDOUT / ECONNRESET     → network blip, reintentar normal (multiplier 1x)
//   - 4xx (excepto 429)          → NO reintentar (error de cliente)
//   - 5xx                        → reintentar normal (multiplier 1x)
const classifyCloudinaryError = (err) => {
  const httpCode = err && err.http_code;
  const code = (err && err.code) || ""; // ej. "EAI_AGAIN", "ETIMEDOUT"
  const message = (err && err.message) || "";
  const lowerMsg = String(message).toLowerCase();

  // Rate limit
  if (
    httpCode === 429 ||
    lowerMsg.includes("rate exceeded") ||
    lowerMsg.includes("too many requests")
  ) {
    return { shouldRetry: true, reason: "rate_limit", multiplier: 30 };
  }

  // DNS issues — el resolver falló. Backoff largo porque puede tardar
  // en propagarse el cambio de DNS o en reintentar.
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { shouldRetry: true, reason: "dns_error", multiplier: 20 };
  }

  // Server rechaza conexión (Cloudinary caído o tu IP bloqueada)
  if (code === "ECONNREFUSED") {
    return { shouldRetry: true, reason: "connection_refused", multiplier: 20 };
  }

  // Timeouts y resets de conexión — blip de red normal
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EHOSTUNREACH") {
    return { shouldRetry: true, reason: "network_blip", multiplier: 1 };
  }

  // 4xx (client error) — no tiene sentido reintentar el mismo payload
  if (httpCode && httpCode >= 400 && httpCode < 500) {
    return { shouldRetry: false, reason: `client_error_${httpCode}` };
  }

  // 5xx, unknown — reintentar normal
  return { shouldRetry: true, reason: "transient", multiplier: 1 };
};

// Helper: delay con jitter (evita thundering herd cuando N servers reintentan
// al mismo tiempo). El jitter es hasta el 25% del delay base.
const backoffWithJitter = (baseMs) => {
  const jitter = baseMs * 0.25 * Math.random();
  return baseMs + jitter;
};

// Sube con reintentos ADAPTATIVOS:
//   - Si el error es 4xx (client): no reintenta (no tiene sentido)
//   - Si es rate limit (429) o DNS / connection refused: backoff largo
//   - Si es 5xx / network blip: backoff normal
//   - Cualquier reintento: aplica jitter al delay para evitar sincronización
//
// Si la estrategia clasifica el error como "no reintentar", lanza
// inmediatamente sin gastar más intentos.
const uploadBufferWithRetry = async (
  buffer,
  uploadOptions,
  { maxAttempts = 3, baseDelayMs = 1000 } = {}
) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await uploadBufferOnce(buffer, uploadOptions);
    } catch (err) {
      lastError = err;
      const cls = classifyCloudinaryError(err);
      console.warn(
        `[cloudinary-upload] Attempt ${attempt}/${maxAttempts} failed [${cls.reason}]: ${err.message}`
      );

      if (!cls.shouldRetry) {
        console.error(
          `[cloudinary-upload] Non-retryable error (${cls.reason}). Aborting retries.`
        );
        throw err;
      }

      if (attempt < maxAttempts) {
        // Base: exponencial. Multiplier: según tipo de error. Jitter: ±25%.
        const baseDelay = baseDelayMs * Math.pow(2, attempt - 1) * cls.multiplier;
        const delay = backoffWithJitter(baseDelay);
        console.log(
          `[cloudinary-upload] Waiting ${Math.round(delay)}ms before retry (base=${baseDelay}ms, jitter applied)...`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
};

// Persiste un buffer y sus opciones de upload, para que el job
// scripts/retry-pending-uploads.js lo reprocese más tarde.
// Backend: disco (default) o S3 (si PENDING_UPLOADS_BACKEND=s3).
// Devuelve { filePath, sidecarPath }.
const saveForRetry = async (buffer, uploadOptions, metadata = {}) => {
  const ts = Date.now();
  const random = require("crypto").randomBytes(4).toString("hex");
  const fileName = `${ts}_${random}.bin`;
  const sidecarName = `${ts}_${random}.json`;

  if (s3Storage.isEnabled()) {
    // S3: subir el bin, sidecar como metadata object aparte
    const binKey = await s3Storage.putBuffer(fileName, buffer);
    // Sidecar como objeto JSON en S3 también
    const sidecarContent = JSON.stringify(
      {
        uploadOptions,
        metadata,
        createdAt: new Date().toISOString(),
        originalFilename: fileName,
      },
      null,
      2
    );
    const sidecarKey = await s3Storage.putBuffer(sidecarName, Buffer.from(sidecarContent));
    return { filePath: binKey, sidecarPath: sidecarKey };
  } else {
    // Disco
    const filePath = path.join(PENDING_DIR, fileName);
    const sidecarPath = path.join(PENDING_DIR, sidecarName);
    fs.writeFileSync(filePath, buffer);
    fs.writeFileSync(sidecarPath, JSON.stringify(
      {
        uploadOptions,
        metadata,
        createdAt: new Date().toISOString(),
        originalFilename: fileName,
      },
      null,
      2
    ));
    return { filePath, sidecarPath };
  }
};

// Procesa la cola de archivos pendientes. Llamado por el cron job o
// manualmente. Devuelve estadísticas.
const processRetryQueue = async () => {
  let fileNames;
  if (s3Storage.isEnabled()) {
    const objects = await s3Storage.listAll();
    fileNames = objects
      .map((o) => o.Key.replace(s3Storage.S3_PREFIX, ""))
      .filter((k) => k.endsWith(".bin"));
  } else {
    if (!fs.existsSync(PENDING_DIR)) {
      return { processed: 0, succeeded: 0, failed: 0, kept: 0 };
    }
    fileNames = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith(".bin"));
  }

  let succeeded = 0;
  let failed = 0;
  let kept = 0;

  for (const fileName of fileNames) {
    const binKey = s3Storage.isEnabled()
      ? `${s3Storage.S3_PREFIX}${fileName}`
      : path.join(PENDING_DIR, fileName);
    const sidecarKey = s3Storage.isEnabled()
      ? `${s3Storage.S3_PREFIX}${fileName.replace(".bin", ".json")}`
      : path.join(PENDING_DIR, fileName.replace(".bin", ".json"));

    let sidecar;
    try {
      const sidecarContent = s3Storage.isEnabled()
        ? (await s3Storage.getBuffer(sidecarKey)).toString("utf8")
        : fs.readFileSync(sidecarKey, "utf8");
      sidecar = JSON.parse(sidecarContent);
    } catch (err) {
      console.error(
        `[cloudinary-upload] Sidecar missing/corrupt for ${fileName}, skipping`
      );
      failed++;
      continue;
    }

    try {
      // Para S3, uploadFileOnce espera la key sin prefijo
      const keyForUpload = s3Storage.isEnabled()
        ? fileName
        : binKey;
      await uploadFileOnce(keyForUpload, sidecar.uploadOptions);

      // Éxito: borrar el bin y su sidecar
      if (s3Storage.isEnabled()) {
        await s3Storage.deleteObject(binKey);
        await s3Storage.deleteObject(sidecarKey);
      } else {
        fs.unlinkSync(binKey);
        if (fs.existsSync(sidecarKey)) fs.unlinkSync(sidecarKey);
      }
      console.log(`[cloudinary-upload] Retry succeeded for ${fileName}`);
      succeeded++;
    } catch (err) {
      console.warn(
        `[cloudinary-upload] Retry failed for ${fileName}: ${err.message}`
      );
      kept++;
    }
  }

  return { processed: fileNames.length, succeeded, failed, kept };
};

module.exports = {
  uploadBufferOnce,
  uploadFileOnce,
  uploadBufferWithRetry,
  saveForRetry,
  processRetryQueue,
  PENDING_DIR,
  s3Storage, // re-export para que callers puedan chequear isEnabled
};
