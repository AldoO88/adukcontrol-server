// scripts/migrate-cloudinary-folder-structure.js
// One-shot: mueve assets de las carpetas legacy a la nueva estructura
// multi-tenant (edukcontrol/schools/<school_id>/...).
//
// Estructura LEGACY (anterior):
//   edukcontrol/schools/logos/<public_id>     ← logos al root
//   edukcontrol/students/<public_id>          ← fotos de estudiantes al root
//
// Estructura NUEVA (objetivo):
//   edukcontrol/schools/<school_id>/logos/<public_id>
//   edukcontrol/schools/<school_id>/students/<public_id>
//
// Estrategia:
//   1. Listar assets en cada carpeta legacy
//   2. Para cada asset, determinar el entity_id y la school_id destino
//   3. Calcular el nuevo public_id
//   4. Mover con cloudinary.uploader.rename(old, new) (atómico en Cloudinary)
//   5. Actualizar AssetVersion.public_id y School.logoUrl / Student.photoUrl en la DB
//
// Uso:
//   DRY_RUN=1 node scripts/migrate-cloudinary-folder-structure.js   # simula
//   node scripts/migrate-cloudinary-folder-structure.js             # ejecuta
//
// Idempotente: si un asset ya está en la nueva estructura, se skipea.
//   Si falla a mitad, se puede volver a correr sin daño.

require("dotenv").config();

const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");
const School = require("../models/School.model");
const Student = require("../models/Student.model");
const AssetVersion = require("../models/AssetVersion.model");

const DRY_RUN = process.env.DRY_RUN === "1";

// Cloudinary tiene rate limits; con 5 en paralelo es seguro y mucho más
// rápido que secuencial. Con 1000 assets: ~10x más rápido.
const MIGRATE_CONCURRENCY = 5;

// Helper: ejecuta un array de tareas con un límite de concurrencia.
const parallelLimit = async (tasks, limit) => {
  const results = new Array(tasks.length);
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

const LEGACY_FOLDERS = [
  "edukcontrol/schools/logos",
  "edukcontrol/students",
];

// Lista todos los assets en una carpeta
const listAssets = async (folder) => {
  const all = [];
  let nextCursor = null;
  do {
    const opts = { type: "upload", prefix: folder, max_results: 500 };
    if (nextCursor) opts.next_cursor = nextCursor;
    const result = await cloudinary.api.resources(opts);
    all.push(...result.resources);
    nextCursor = result.next_cursor;
  } while (nextCursor);
  return all;
};

// Parsea un public_id LEGACY para extraer el entityId y la schoolId destino.
//   edukcontrol/schools/logos/logo_<school_id>_<ts>   → school_id (es el entity)
//   edukcontrol/students/photo_<student_id>_<ts>      → student_id; school_id = lookup
const parseLegacyPath = (publicId) => {
  const logoMatch = publicId.match(
    /^edukcontrol\/schools\/logos\/logo_([a-f0-9]{24})_\d+$/
  );
  if (logoMatch) {
    return {
      type: "logo",
      entityId: logoMatch[1],
      schoolId: logoMatch[1], // el entity ES la school
    };
  }
  const photoMatch = publicId.match(
    /^edukcontrol\/students\/photo_([a-f0-9]{24})_\d+$/
  );
  if (photoMatch) {
    return {
      type: "photo",
      entityId: photoMatch[1],
      schoolId: null, // se obtiene del Student
    };
  }
  return null;
};

// Construye el nuevo public_id a partir del viejo y la schoolId destino.
const buildNewPublicId = (oldPublicId, newSchoolId) => {
  // edukcontrol/schools/logos/logo_X_TS     → edukcontrol/schools/<X>/logos/logo_X_TS
  // edukcontrol/students/photo_X_TS        → edukcontrol/schools/<Y>/students/photo_X_TS
  if (oldPublicId.startsWith("edukcontrol/schools/logos/")) {
    const filename = oldPublicId.substring("edukcontrol/schools/logos/".length);
    return `edukcontrol/schools/${newSchoolId}/logos/${filename}`;
  }
  if (oldPublicId.startsWith("edukcontrol/students/")) {
    const filename = oldPublicId.substring("edukcontrol/students/".length);
    return `edukcontrol/schools/${newSchoolId}/students/${filename}`;
  }
  return null;
};

// Reemplaza el prefijo de folder en una URL de Cloudinary.
const updateUrlFolder = (url, newPublicId) => {
  if (!url) return null;
  return url.replace(/\/upload\/(?:v\d+\/)?.+$/, `/upload/${newPublicId}`);
};

// Mueve un asset de una carpeta a otra (atómico en Cloudinary).
const moveAsset = async (oldPublicId, newPublicId) => {
  if (DRY_RUN) return { result: "ok", simulated: true };
  const result = await cloudinary.uploader.rename(oldPublicId, newPublicId, {
    overwrite: false,
    invalidate: true,
  });
  return result;
};

const migrateFolder = async (folder) => {
  console.log(`\n[migrate] === Scanning ${folder}/ ===`);
  const assets = await listAssets(`${folder}/`);
  console.log(`[migrate] Found ${assets.length} legacy asset(s)`);

  if (assets.length === 0) return { moved: 0, skipped: 0, errors: 0 };

  // Pre-cargar schools y students potencialmente referenciados
  const studentIds = new Set();
  for (const a of assets) {
    const meta = parseLegacyPath(a.public_id);
    if (meta && meta.type === "photo") studentIds.add(meta.entityId);
  }

  console.log(
    `[migrate] Pre-loading ${studentIds.size} student(s)...`
  );
  const students = await Student.find({
    _id: { $in: [...studentIds] },
  })
    .select("_id school")
    .lean();
  const studentById = new Map(students.map((s) => [String(s._id), s]));

  // También cargar todas las schools (para los logos)
  const allSchools = await School.find({}).select("_id").lean();
  const schoolExists = new Set(allSchools.map((s) => String(s._id)));

  // FASE 1: plan — parsear todos los assets, resolver schoolId, calcular
  // nuevas rutas. Esto es solo CPU/DB, no toca Cloudinary, así que puede
  // ser rápido y sin límite de concurrencia.
  const plan = []; // { asset, meta, newPublicId, newUrl }
  for (const asset of assets) {
    const meta = parseLegacyPath(asset.public_id);
    if (!meta) {
      console.warn(`[migrate] Unrecognized format: ${asset.public_id}`);
      skipped++;
      continue;
    }

    // Resolver la schoolId destino
    let schoolId;
    if (meta.type === "logo") {
      schoolId = meta.schoolId;
      if (!schoolExists.has(schoolId)) {
        console.warn(
          `[migrate] SKIP (school not in DB): ${asset.public_id}`
        );
        skipped++;
        continue;
      }
    } else {
      const student = studentById.get(meta.entityId);
      if (!student) {
        console.warn(
          `[migrate] SKIP (student not in DB): ${asset.public_id}`
        );
        skipped++;
        continue;
      }
      schoolId = String(student.school);
    }

    const newPublicId = buildNewPublicId(asset.public_id, schoolId);
    if (!newPublicId) {
      console.warn(`[migrate] Cannot compute new path for: ${asset.public_id}`);
      skipped++;
      continue;
    }

    if (newPublicId === asset.public_id) {
      console.log(`[migrate] Already migrated: ${asset.public_id}`);
      skipped++;
      continue;
    }

    const newUrl = updateUrlFolder(asset.secure_url, newPublicId);
    plan.push({ asset, meta, newPublicId, newUrl });
  }

  console.log(
    `[migrate] Plan: ${plan.length} asset(s) to move, ${skipped} skipped`
  );

  // FASE 2: mover en Cloudinary en paralelo (con límite de concurrencia).
  // Cada task devuelve { oldId, newId, success, error }.
  const moveTasks = plan.map(
    (p) => async () => {
      try {
        if (DRY_RUN) {
          console.log(
            `[migrate] [DRY_RUN] would move: ${p.asset.public_id} → ${p.newPublicId}`
          );
          return { oldId: p.asset.public_id, newId: p.newPublicId, success: true, simulated: true };
        }
        console.log(
          `[migrate] Moving: ${p.asset.public_id} → ${p.newPublicId}`
        );
        await moveAsset(p.asset.public_id, p.newPublicId);
        return { oldId: p.asset.public_id, newId: p.newPublicId, success: true };
      } catch (err) {
        console.error(
          `[migrate] ERROR moving ${p.asset.public_id}: ${err.message}`
        );
        return { oldId: p.asset.public_id, newId: p.newPublicId, success: false, error: err.message };
      }
    }
  );
  const moveResults = await parallelLimit(moveTasks, MIGRATE_CONCURRENCY);

  // FASE 3: actualizar DB en paralelo.
  // Solo si NO estamos en DRY_RUN.
  if (!DRY_RUN) {
    const toUpdateAssetVersion = moveResults.filter((r) => r.success);
    const toUpdateEntity = [];

    // Mapear los moves exitosos a las entity updates
    for (const moveRes of toUpdateAssetVersion) {
      const p = plan.find((x) => x.asset.public_id === moveRes.oldId);
      if (!p) continue;
      if (p.meta.type === "logo") {
        toUpdateEntity.push({
          type: "logo",
          schoolId: p.meta.entityId,
          newUrl: p.newUrl,
        });
      } else {
        toUpdateEntity.push({
          type: "photo",
          studentId: p.meta.entityId,
          newUrl: p.newUrl,
        });
      }
    }

    // 3a. AssetVersion: cambiar el public_id (updateMany en paralelo)
    const avTasks = toUpdateAssetVersion.map((u) => async () => {
      const result = await AssetVersion.updateMany(
        { public_id: u.oldId },
        { $set: { public_id: u.newId } }
      );
      if (result.modifiedCount > 0) {
        console.log(
          `[migrate] Updated ${result.modifiedCount} AssetVersion record(s) for ${u.oldId}`
        );
      }
    });
    await parallelLimit(avTasks, MIGRATE_CONCURRENCY);

    // 3b. Schools: actualizar logoUrl
    const schoolTasks = toUpdateEntity
      .filter((u) => u.type === "logo")
      .map((upd) => async () => {
        const result = await School.updateOne(
          {
            _id: upd.schoolId,
            logoUrl: { $regex: escapeRegex(oldUrlToPublicId(upd.newUrl)) },
          },
          { $set: { logoUrl: upd.newUrl } }
        );
        if (result.modifiedCount > 0) {
          console.log(`[migrate] Updated School ${upd.schoolId} logoUrl`);
        }
      });
    await parallelLimit(schoolTasks, MIGRATE_CONCURRENCY);

    // 3c. Students: actualizar photoUrl si la URL actual apuntaba a un asset movido
    const studentTasks = toUpdateEntity
      .filter((u) => u.type === "photo")
      .map((upd) => async () => {
        const student = await Student.findById(upd.studentId)
          .select("photoUrl")
          .lean();
        if (!student) return;
        const oldPublicId = extractPublicIdFromUrl(student.photoUrl);
        const matchingUpdate = toUpdateAssetVersion.find(
          (a) => a.oldId === oldPublicId
        );
        if (matchingUpdate) {
          await Student.updateOne(
            { _id: upd.studentId },
            { $set: { photoUrl: upd.newUrl } }
          );
          console.log(
            `[migrate] Updated Student ${upd.studentId} photoUrl`
          );
        }
      });
    await parallelLimit(studentTasks, MIGRATE_CONCURRENCY);
  }

  // Contar resultados
  const successCount = moveResults.filter((r) => r.success).length;
  const errorCount = moveResults.filter((r) => !r.success).length;
  return {
    moved: successCount,
    skipped,
    errors: errorCount,
  };
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractPublicIdFromUrl = (url) => {
  if (!url) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z]+)?$/);
  return match ? match[1] : null;
};

const oldUrlToPublicId = (url) => {
  const id = extractPublicIdFromUrl(url);
  return id ? `${id}\\.[a-z]+$` : "^$";
};

async function main() {
  if (DRY_RUN) {
    console.log("[migrate] DRY_RUN=1: no se moverá nada, solo se simula");
  }
  console.log("[migrate] Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    let totalMoved = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const folder of LEGACY_FOLDERS) {
      const result = await migrateFolder(folder);
      totalMoved += result.moved;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
    }

    console.log("\n[migrate] === SUMMARY ===");
    console.log(`  moved=${totalMoved} skipped=${totalSkipped} errors=${totalErrors}`);
    if (DRY_RUN) {
      console.log(
        "\n[migrate] DRY_RUN mode — no se movió nada. Corre sin DRY_RUN=1 para ejecutar."
      );
    } else if (totalMoved > 0) {
      console.log(
        `\n[migrate] Migrated ${totalMoved} asset(s) to the new folder structure.`
      );
    } else {
      console.log("\n[migrate] Nothing to migrate.");
    }
  } catch (error) {
    console.error("[migrate] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[migrate] Disconnected");
  }
}

main();
