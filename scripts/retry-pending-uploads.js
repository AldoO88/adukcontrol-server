// scripts/retry-pending-uploads.js
// Procesa la cola de archivos que fallaron al subirse a Cloudinary.
// Esos archivos quedaron en /tmp/eduk-pending-uploads/ (o el directorio
// configurado en PENDING_UPLOADS_DIR) cuando todos los reintentos
// in-line del controller fallaron.
//
// Uso:
//   node scripts/retry-pending-uploads.js
//
// Se recomienda correrlo periódicamente (cron cada 5-15 minutos) o
// después de un outage de Cloudinary.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const AssetVersion = require("../models/AssetVersion.model");
const School = require("../models/School.model");
const Student = require("../models/Student.model");
const sseService = require("../services/sse.service");
const {
  processRetryQueue,
  PENDING_DIR,
} = require("../services/cloudinary-upload.service");

// Borrar archivos huérfanos (sin sidecar) y archivos más viejos de N días.
const cleanupOrphans = (maxAgeDays = 7) => {
  if (!fs.existsSync(PENDING_DIR)) {
    return { orphans: 0, old: 0 };
  }
  const files = fs.readdirSync(PENDING_DIR);
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  let orphans = 0;
  let old = 0;

  // 1. .bin sin .json sidecar (huérfanos)
  const binFiles = files.filter((f) => f.endsWith(".bin"));
  for (const bin of binFiles) {
    const sidecar = bin.replace(".bin", ".json");
    if (!files.includes(sidecar)) {
      const fullPath = path.join(PENDING_DIR, bin);
      console.log(`[retry-uploads] Deleting orphan: ${bin}`);
      fs.unlinkSync(fullPath);
      orphans++;
    }
  }

  // 2. .bin/.json más viejos de maxAgeDays
  for (const file of files) {
    const fullPath = path.join(PENDING_DIR, file);
    const stat = fs.statSync(fullPath);
    if (now - stat.mtimeMs > maxAgeMs) {
      console.log(`[retry-uploads] Deleting old (${maxAgeDays}d+): ${file}`);
      fs.unlinkSync(fullPath);
      old++;
    }
  }

  return { orphans, old };
};

// Después de un retry exitoso, actualizar la DB y notificar al cliente por SSE.
const onRetrySuccess = async (sidecar, result) => {
  const { entity_type, entity_id, uploaded_by } = sidecar.metadata || {};
  if (!entity_type || !entity_id) return;

  if (entity_type === "school") {
    const school = await School.findById(entity_id);
    if (!school) return;
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
      uploaded_by: uploaded_by || null,
    });
  } else if (entity_type === "student") {
    const student = await Student.findById(entity_id);
    if (!student) return;
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
      uploaded_by: uploaded_by || null,
    });
  }

  // Notificar al cliente por SSE
  if (uploaded_by) {
    sseService.notify(uploaded_by, "upload_completed", {
      entity_type,
      entity_id,
      url: result.secure_url,
      public_id: result.public_id,
    });
  }
};

// Wrapper que notifica por SSE cuando hay éxito.
const processRetryQueueWithNotify = async () => {
  if (!fs.existsSync(PENDING_DIR)) {
    return { processed: 0, succeeded: 0, failed: 0, kept: 0 };
  }

  const files = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith(".bin"));
  let succeeded = 0;
  let failed = 0;
  let kept = 0;

  const { uploadFileOnce } = require("../services/cloudinary-upload.service");

  for (const fileName of files) {
    const filePath = path.join(PENDING_DIR, fileName);
    const sidecarPath = path.join(PENDING_DIR, fileName.replace(".bin", ".json"));

    let sidecar;
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
    } catch (err) {
      console.error(
        `[retry-uploads] Sidecar missing/corrupt for ${fileName}, skipping`
      );
      failed++;
      continue;
    }

    try {
      const result = await uploadFileOnce(filePath, sidecar.uploadOptions);
      fs.unlinkSync(filePath);
      if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);
      console.log(`[retry-uploads] Retry succeeded for ${fileName}`);
      succeeded++;

      // Notificar DB + SSE
      try {
        await onRetrySuccess(sidecar, result);
      } catch (err) {
        console.error(
          `[retry-uploads] Post-retry DB/SSE update failed: ${err.message}`
        );
      }
    } catch (err) {
      console.warn(
        `[retry-uploads] Retry failed for ${fileName}: ${err.message}`
      );
      kept++;
    }
  }

  return { processed: files.length, succeeded, failed, kept };
};

async function main() {
  // Limpieza primero
  console.log("[retry-uploads] Cleaning orphans and old files...");
  const cleanup = cleanupOrphans(7);
  console.log(
    `[retry-uploads] Cleanup: orphans=${cleanup.orphans} old=${cleanup.old}`
  );

  // Conectar a Mongo (necesario para actualizar DB y notificar)
  console.log("[retry-uploads] Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    console.log(`[retry-uploads] Scanning ${PENDING_DIR}...`);
    const result = await processRetryQueueWithNotify();
    console.log(
      `[retry-uploads] DONE. processed=${result.processed} succeeded=${result.succeeded} kept=${result.kept}`
    );
    if (result.failed > 0) {
      console.warn(
        `[retry-uploads] ${result.failed} sidecar(s) missing or corrupt (skipped).`
      );
    }
  } catch (error) {
    console.error("[retry-uploads] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[retry-uploads] Disconnected");
  }
}

main();
