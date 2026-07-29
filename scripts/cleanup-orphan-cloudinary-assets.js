// scripts/cleanup-orphan-cloudinary-assets.js
// Limpia assets huérfanos y versiones antiguas en Cloudinary.
//
// Estructura de carpetas escaneada (multi-tenant):
//   edukcontrol/schools/<school._id>/logos/logo_<school._id>_<ts>
//   edukcontrol/schools/<school._id>/students/photo_<student._id>_<ts>
//
// Para cada asset:
//   1. Extrae school._id y entity._id de la ruta y el public_id
//   2. Si la escuela ya no existe en la DB → huérfano
//   3. Si la versión actual (logoUrl/photoUrl) coincide → mantiene
//   4. Si no coincide → versión antigua, borrar de Cloudinary
//   5. Soft-delete el AssetVersion (set deletedAt; TTL 90 días lo borra)
//
// Uso:
//   DRY_RUN=1 node scripts/cleanup-orphan-cloudinary-assets.js   # solo loggea
//   node scripts/cleanup-orphan-cloudinary-assets.js             # borra de verdad
//
// Se recomienda correrlo periódicamente (cron diario) o después de migraciones.

require("dotenv").config();

const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");
const School = require("../models/School.model");
const Student = require("../models/Student.model");
const AssetVersion = require("../models/AssetVersion.model");

const DRY_RUN = process.env.DRY_RUN === "1";
const DELETE_CONCURRENCY = 5;

// Límite de concurrencia para delete_resources. Cloudinary tiene rate limits.
const parallelLimit = async (tasks, limit) => {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < tasks.length) {
      const myIndex = index++;
      results[myIndex] = await tasks[myIndex]();
    }
  });
  await Promise.all(workers);
  return results;
};

// Pagina sobre todos los assets bajo un prefijo (recursive o no).
const listAllInPrefix = async (prefix) => {
  const all = [];
  let nextCursor = null;
  do {
    const opts = {
      type: "upload",
      prefix,
      max_results: 500,
      resource_type: "image",
    };
    if (nextCursor) opts.next_cursor = nextCursor;
    const result = await cloudinary.api.resources(opts);
    all.push(...result.resources);
    nextCursor = result.next_cursor;
  } while (nextCursor);
  return all;
};

// Extrae el public_id de una URL de Cloudinary.
// Formato: https://res.cloudinary.com/<cloud>/image/upload/v12345/folder/asset.webp
const extractPublicIdFromUrl = (url) => {
  if (!url) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z]+)?$/);
  return match ? match[1] : null;
};

// Parsea un public_id con el nuevo formato multi-tenant.
// Formatos esperados:
//   edukcontrol/schools/<school_id>/logos/logo_<school_id>_<ts>
//   edukcontrol/schools/<school_id>/students/photo_<student_id>_<ts>
const parseAssetPath = (publicId) => {
  const logoMatch = publicId.match(
    /^edukcontrol\/schools\/([a-f0-9]{24})\/logos\/(.+)$/
  );
  if (logoMatch) {
    return {
      type: "logo",
      schoolId: logoMatch[1],
      entityId: logoMatch[1], // logo pertenece a la escuela
      prefix: `logo_`,
    };
  }
  const photoMatch = publicId.match(
    /^edukcontrol\/schools\/([a-f0-9]{24})\/students\/(.+)$/
  );
  if (photoMatch) {
    return {
      type: "photo",
      schoolId: photoMatch[1],
      // El entityId (student) está en el public_id, no en la ruta
      // Lo extraemos del filename
      entityId: null, // se setea abajo
      prefix: `photo_`,
    };
  }
  return null; // formato no reconocido (e.g. legacy uploads)
};

// Extrae el entityId de un filename con prefijo conocido.
//   logo_<school_id>_<ts>     → entityId = school_id
//   photo_<student_id>_<ts>   → entityId = student_id
const extractEntityIdFromFilename = (filename, prefix) => {
  // filename es la parte después del último "/", ej. "logo_65a1b_1700"
  const match = filename.match(new RegExp(`^${prefix}([a-f0-9]{24})_`));
  return match ? match[1] : null;
};

// Procesa TODOS los assets bajo edukcontrol/schools/.
// (Un solo API call recursivo: usamos el prefix raíz y dejamos que
// Cloudinary nos devuelva todo el árbol.)
const cleanupAllSchools = async () => {
  console.log("[cleanup] === Scanning edukcontrol/schools/ ===");
  const assets = await listAllInPrefix("edukcontrol/schools/");
  console.log(`[cleanup] Found ${assets.length} asset(s) total`);

  if (assets.length === 0) {
    return { deleted: 0, kept: 0, orphans: 0, errors: 0 };
  }

  // Parsear y clasificar todos los assets primero
  const parsed = [];
  const unknown = [];
  for (const asset of assets) {
    const meta = parseAssetPath(asset.public_id);
    if (!meta) {
      unknown.push(asset);
      continue;
    }
    if (meta.type === "photo") {
      const filename = asset.public_id.split("/").pop();
      meta.entityId = extractEntityIdFromFilename(filename, meta.prefix);
      if (!meta.entityId) {
        unknown.push(asset);
        continue;
      }
    }
    parsed.push({ asset, meta });
  }

  if (unknown.length > 0) {
    console.warn(
      `[cleanup] ${unknown.length} asset(s) with unrecognized format (skipped):`
    );
    for (const u of unknown.slice(0, 5)) {
      console.warn(`  - ${u.public_id}`);
    }
    if (unknown.length > 5) {
      console.warn(`  ... and ${unknown.length - 5} more`);
    }
  }

  // Pre-cargar todas las escuelas y estudiantes referenciados (un query por colección)
  const schoolIds = [...new Set(parsed.map((p) => p.meta.schoolId))];
  const studentIds = parsed
    .filter((p) => p.meta.type === "photo")
    .map((p) => p.meta.entityId);
  const uniqueStudentIds = [...new Set(studentIds)];

  console.log(
    `[cleanup] Pre-loading ${schoolIds.length} school(s) and ${uniqueStudentIds.length} student(s)...`
  );
  const [allSchools, allStudents] = await Promise.all([
    School.find({ _id: { $in: schoolIds } })
      .select("_id logoUrl cct name")
      .lean(),
    Student.find({ _id: { $in: uniqueStudentIds } })
      .select("_id photoUrl school")
      .lean(),
  ]);
  const schoolById = new Map(allSchools.map((s) => [String(s._id), s]));
  const studentById = new Map(allStudents.map((s) => [String(s._id), s]));

  // Clasificar cada asset
  const toDelete = [];
  const toSoftDelete = [];
  let kept = 0;
  let orphans = 0;
  let errors = 0;

  for (const { asset, meta } of parsed) {
    const school = schoolById.get(meta.schoolId);
    if (!school) {
      // Escuela no existe en la DB → huérfano
      console.log(
        `[cleanup] ORPHAN (${meta.type}): ${asset.public_id} (school ${meta.schoolId} not found)`
      );
      toDelete.push(asset.public_id);
      toSoftDelete.push({
        public_id: asset.public_id,
        reason: "orphan_school",
        entity_type: meta.type === "logo" ? "school" : "student",
        entity_id: meta.entityId,
      });
      orphans++;
      continue;
    }

    if (meta.type === "logo") {
      // Es un logo. ¿Es la versión actual de esta escuela?
      const currentPublicId = extractPublicIdFromUrl(school.logoUrl);
      if (currentPublicId === asset.public_id) {
        kept++;
      } else {
        console.log(
          `[cleanup] OLD LOGO: ${asset.public_id} (current is ${currentPublicId || "none"})`
        );
        toDelete.push(asset.public_id);
        toSoftDelete.push({
          public_id: asset.public_id,
          reason: "old_version",
          entity_type: "school",
          entity_id: meta.entityId,
        });
      }
    } else {
      // Es una foto de estudiante. ¿Pertenece a la escuela del path?
      // Si la escuela del student no coincide con la escuela del path,
      // es un asset huérfano (movido o re-asignado).
      const student = studentById.get(meta.entityId);
      if (!student) {
        console.log(
          `[cleanup] ORPHAN (photo): ${asset.public_id} (student ${meta.entityId} not found)`
        );
        toDelete.push(asset.public_id);
        toSoftDelete.push({
          public_id: asset.public_id,
          reason: "orphan_student",
          entity_type: "student",
          entity_id: meta.entityId,
        });
        orphans++;
        continue;
      }
      // Verificar que el student pertenezca a la escuela del path
      if (String(student.school) !== meta.schoolId) {
        console.log(
          `[cleanup] MISMATCH: ${asset.public_id} (student belongs to school ${student.school}, but path says ${meta.schoolId})`
        );
        toDelete.push(asset.public_id);
        toSoftDelete.push({
          public_id: asset.public_id,
          reason: "school_mismatch",
          entity_type: "student",
          entity_id: meta.entityId,
        });
        orphans++;
        continue;
      }
      // ¿Es la versión actual?
      const currentPublicId = extractPublicIdFromUrl(student.photoUrl);
      if (currentPublicId === asset.public_id) {
        kept++;
      } else {
        console.log(
          `[cleanup] OLD PHOTO: ${asset.public_id} (current is ${currentPublicId || "none"})`
        );
        toDelete.push(asset.public_id);
        toSoftDelete.push({
          public_id: asset.public_id,
          reason: "old_version",
          entity_type: "student",
          entity_id: meta.entityId,
        });
      }
    }
  }

  // Borrar de Cloudinary (paginado y con concurrencia limitada)
  if (toDelete.length > 0 && !DRY_RUN) {
    const chunks = [];
    for (let i = 0; i < toDelete.length; i += 1000) {
      chunks.push(toDelete.slice(i, i + 1000));
    }
    const tasks = chunks.map(
      (chunk) => () =>
        cloudinary.api.delete_resources(chunk, { invalidate: true })
    );
    await parallelLimit(tasks, DELETE_CONCURRENCY);
  }

  // Soft-delete en la DB
  if (toSoftDelete.length > 0) {
    const publicIds = toSoftDelete.map((x) => x.public_id);
    const now = new Date();
    const updateResult = await AssetVersion.updateMany(
      { public_id: { $in: publicIds }, deletedAt: null },
      { $set: { deletedAt: now } }
    );
    console.log(
      `[cleanup] Soft-deleted ${updateResult.modifiedCount} AssetVersion record(s)`
    );
  }

  return { deleted: toDelete.length, kept, orphans, errors };
};

async function main() {
  if (DRY_RUN) {
    console.log("[cleanup] DRY_RUN=1: no se borrará nada, solo se loggea");
  }
  console.log("[cleanup] Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const result = await cleanupAllSchools();

    console.log("\n[cleanup] === SUMMARY ===");
    console.log(
      `  kept=${result.kept} deleted=${result.deleted} (orphans=${result.orphans})`
    );
    if (DRY_RUN) {
      console.log(
        "\n[cleanup] DRY_RUN mode — no se borró nada. Corre sin DRY_RUN=1 para borrar."
      );
    } else if (result.deleted > 0) {
      console.log(
        `\n[cleanup] Deleted ${result.deleted} asset(s) from Cloudinary.`
      );
    } else {
      console.log("\n[cleanup] Nothing to delete.");
    }
  } catch (error) {
    console.error("[cleanup] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[cleanup] Disconnected");
  }
}

main();
