// scripts/cleanup-old-s3-uploads.js
// Borra objetos en el bucket S3 de uploads pendientes que tengan más de N días.
// Complementa el lifecycle policy del bucket (recomendado tener ambos).
//
// Uso:
//   node scripts/cleanup-old-s3-uploads.js
//
// Variables de entorno requeridas (mismas que el resto del sistema):
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
//   S3_PENDING_UPLOADS_BUCKET
//   PENDING_UPLOADS_BACKEND=s3
//
// Cron sugerido: diario a las 4am (complementa el lifecycle de S3 que suele ser más conservador).

require("dotenv").config();

const s3Storage = require("../services/s3-storage.service");

const MAX_AGE_DAYS = parseInt(process.env.S3_CLEANUP_MAX_AGE_DAYS || "30", 10);

async function main() {
  if (!s3Storage.isEnabled()) {
    console.error(
      "[s3-cleanup] PENDING_UPLOADS_BACKEND must be 's3'. Aborting."
    );
    process.exit(1);
  }

  console.log(
    `[s3-cleanup] Listing objects in s3://${process.env.S3_PENDING_UPLOADS_BUCKET}/${s3Storage.S3_PREFIX}`
  );

  const objects = await s3Storage.listAll();
  console.log(`[s3-cleanup] Found ${objects.length} object(s)`);

  const now = Date.now();
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let kept = 0;

  for (const obj of objects) {
    const ageMs = now - new Date(obj.LastModified).getTime();
    const ageDays = (ageMs / (24 * 60 * 60 * 1000)).toFixed(1);
    if (ageMs > maxAgeMs) {
      console.log(
        `[s3-cleanup] Deleting (${ageDays}d old): ${obj.Key} (${obj.Size} bytes)`
      );
      await s3Storage.deleteObject(obj.Key);
      deleted++;
    } else {
      kept++;
    }
  }

  console.log(`[s3-cleanup] DONE. deleted=${deleted} kept=${kept}`);
}

main().catch((err) => {
  console.error("[s3-cleanup] FAILED:", err);
  process.exit(1);
});
