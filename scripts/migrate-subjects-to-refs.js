// scripts/migrate-subjects-to-refs.js
// Migra el String libre de materia a una referencia al catálogo Subject:
//   Grade.subject          (String) → Grade.subject_id          (ref Subject)
//   TeacherSubject.subject (String) → TeacherSubject.subject_id (ref Subject)
//
// Qué hace, en orden:
//   1. Junta todos los nombres de materia que existan en Grade y en
//      TeacherSubject, agrupados por escuela.
//   2. Los empata contra el catálogo Subject de esa escuela ignorando
//      mayúsculas, acentos y espacios ("Matemáticas" == "matematicas").
//      Los que no existan se CREAN con un `code` derivado del nombre.
//   3. PRE-FLIGHT: detecta las filas que colisionarían contra los nuevos
//      índices únicos (dos grafías distintas de la misma materia para el mismo
//      alumno y período). Si encuentra alguna, ABORTA sin escribir nada.
//   4. Reescribe Grade y TeacherSubject, y dropea los índices viejos.
//
// Uso:
//   DRY_RUN=1 node scripts/migrate-subjects-to-refs.js   # simula, no escribe
//   node scripts/migrate-subjects-to-refs.js             # aplica
//
// IMPORTANTE: hacer BACKUP antes. Correr DESPUÉS de migrate-grade-periods.js
// (el pre-flight de Grade agrupa por gradingPeriod, que ese script crea).
// Es idempotente: las filas que ya tienen subject_id se ignoran.

require("dotenv").config();

const mongoose = require("mongoose");
const Grade = require("../models/Grade.model");
const Subject = require("../models/Subject.model");
const TeacherSubject = require("../models/TeacherSubject.model");

const DRY_RUN = process.env.DRY_RUN === "1";
const LOG = "[migrate-subjects]";

// "Educación Física " → "EDUCACION FISICA". Quita acentos y normaliza espacios
// para que las variantes de captura empaten con una sola materia del catálogo.
const normalizeName = (name) =>
  String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marcas diacríticas combinantes
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

// "Matemáticas" → "MAT". Base del código autogenerado.
const codeBase = (name) => {
  const alnum = normalizeName(name).replace(/[^A-Z0-9]/g, "");
  return alnum.slice(0, 3) || "SUB";
};

// Devuelve un `code` libre dentro de la escuela: MAT-001, MAT-002, ...
const nextFreeCode = (name, usedCodes) => {
  const base = codeBase(name);
  for (let n = 1; n < 1000; n += 1) {
    const candidate = `${base}-${String(n).padStart(3, "0")}`;
    if (!usedCodes.has(candidate)) {
      usedCodes.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not allocate a free subject code for "${name}".`);
};

// Junta los nombres de materia usados por escuela, desde ambas colecciones.
async function collectSubjectNamesBySchool() {
  const bySchool = new Map(); // schoolId → Set<nombre original>

  const add = (school, subject) => {
    if (!school || !subject) return;
    const key = String(school);
    if (!bySchool.has(key)) bySchool.set(key, new Set());
    bySchool.get(key).add(String(subject).trim());
  };

  const gradeRows = await Grade.aggregate([
    { $match: { subject: { $type: "string" }, subject_id: { $exists: false } } },
    { $group: { _id: { school: "$school", subject: "$subject" } } },
  ]);
  for (const r of gradeRows) add(r._id.school, r._id.subject);

  const tsRows = await TeacherSubject.aggregate([
    { $match: { subject: { $type: "string" }, subject_id: { $exists: false } } },
    { $group: { _id: { school: "$school", subject: "$subject" } } },
  ]);
  for (const r of tsRows) add(r._id.school, r._id.subject);

  return bySchool;
}

// Empata (o crea) los Subject de una escuela. Devuelve Map<nombreNormalizado, subjectDoc>.
async function resolveCatalogForSchool(schoolId, names) {
  const existing = await Subject.find({ school: schoolId }).lean();

  const byNormalized = new Map();
  const usedCodes = new Set();
  for (const s of existing) {
    usedCodes.add(s.code);
    const key = normalizeName(s.name);
    // Si el catálogo ya trae nombres duplicados nos quedamos con el primero;
    // deduplicar el catálogo es una tarea manual aparte.
    if (!byNormalized.has(key)) byNormalized.set(key, s);
  }

  for (const name of names) {
    const key = normalizeName(name);
    if (!key || byNormalized.has(key)) continue;

    const doc = {
      school: schoolId,
      code: nextFreeCode(name, usedCodes),
      name: String(name).trim(),
      isActive: true,
    };

    if (DRY_RUN) {
      console.log(`${LOG}   would create Subject "${doc.name}" (${doc.code})`);
      byNormalized.set(key, { ...doc, _id: `dry-run-${doc.code}` });
      continue;
    }

    const created = await Subject.create(doc);
    console.log(`${LOG}   created Subject "${created.name}" (${created.code})`);
    byNormalized.set(key, created.toObject());
  }

  return byNormalized;
}

// Detecta filas que romperían los nuevos índices únicos al unificar grafías.
// Devuelve un array de descripciones legibles (vacío = todo limpio).
async function preflightCollisions(catalogBySchool) {
  const problems = [];
  const idFor = (school, subject) => {
    const catalog = catalogBySchool.get(String(school));
    const entry = catalog && catalog.get(normalizeName(subject));
    return entry ? String(entry._id) : null;
  };

  // --- Grade: (enrollment_id, subject_id, gradingPeriod) debe ser único ---
  const gradeRows = await Grade.aggregate([
    { $match: { subject: { $type: "string" }, subject_id: { $exists: false } } },
    {
      $group: {
        _id: {
          enrollment_id: "$enrollment_id",
          gradingPeriod: "$gradingPeriod",
          subject: "$subject",
        },
        school: { $first: "$school" },
        count: { $sum: 1 },
      },
    },
  ]);

  const gradeSeen = new Map();
  for (const row of gradeRows) {
    const subjectId = idFor(row.school, row._id.subject);
    if (!subjectId) continue;
    const key = `${row._id.enrollment_id}|${row._id.gradingPeriod}|${subjectId}`;
    const prev = gradeSeen.get(key);
    if (prev) {
      problems.push(
        `Grade: enrollment ${row._id.enrollment_id}, período ${row._id.gradingPeriod} — "${prev}" y "${row._id.subject}" se unifican en la misma materia.`
      );
    } else {
      gradeSeen.set(key, row._id.subject);
    }
    // Duplicado exacto preexistente (el índice viejo debería haberlo impedido).
    if (row.count > 1) {
      problems.push(
        `Grade: ${row.count} notas duplicadas para enrollment ${row._id.enrollment_id}, período ${row._id.gradingPeriod}, materia "${row._id.subject}".`
      );
    }
  }

  // --- TeacherSubject: (teacher, subject_id, group, year) debe ser único ---
  const tsRows = await TeacherSubject.aggregate([
    { $match: { subject: { $type: "string" }, subject_id: { $exists: false } } },
    {
      $group: {
        _id: {
          teacher_id: "$teacher_id",
          group_id: "$group_id",
          school_year_id: "$school_year_id",
          subject: "$subject",
        },
        school: { $first: "$school" },
        count: { $sum: 1 },
      },
    },
  ]);

  const tsSeen = new Map();
  for (const row of tsRows) {
    const subjectId = idFor(row.school, row._id.subject);
    if (!subjectId) continue;
    const key = `${row._id.teacher_id}|${row._id.group_id}|${row._id.school_year_id}|${subjectId}`;
    const prev = tsSeen.get(key);
    if (prev) {
      problems.push(
        `TeacherSubject: maestro ${row._id.teacher_id}, grupo ${row._id.group_id} — "${prev}" y "${row._id.subject}" se unifican en la misma materia.`
      );
    } else {
      tsSeen.set(key, row._id.subject);
    }
  }

  return problems;
}

// Dropea un índice si existe; ignora "no existe".
async function dropIndexIfExists(Model, indexName) {
  try {
    await Model.collection.dropIndex(indexName);
    console.log(`${LOG} Índice viejo ${indexName} eliminado.`);
  } catch (err) {
    if (err.codeName === "IndexNotFound" || err.code === 27) {
      console.log(`${LOG} El índice ${indexName} ya no existía.`);
    } else {
      throw err;
    }
  }
}

async function main() {
  console.log(`${LOG} Connecting to MongoDB...`);
  await mongoose.connect(process.env.MONGO_URI);

  if (DRY_RUN) console.log(`${LOG} DRY_RUN=1 — no se escribirá nada.`);

  try {
    // --- 1 y 2. Catálogo por escuela ------------------------------------
    const namesBySchool = await collectSubjectNamesBySchool();

    if (namesBySchool.size === 0) {
      console.log(`${LOG} No hay filas con \`subject\` sin migrar. Nada que hacer.`);
      return;
    }

    const catalogBySchool = new Map();
    for (const [schoolId, names] of namesBySchool.entries()) {
      console.log(`${LOG} school=${schoolId}: ${names.size} nombres de materia`);
      catalogBySchool.set(schoolId, await resolveCatalogForSchool(schoolId, names));
    }

    // --- 3. Pre-flight ---------------------------------------------------
    const problems = await preflightCollisions(catalogBySchool);
    if (problems.length > 0) {
      console.error(
        `\n${LOG} ABORTADO: ${problems.length} colisión(es) romperían los índices únicos nuevos.`
      );
      console.error(
        `${LOG} Resuélvelas a mano (borra o fusiona las filas duplicadas) y vuelve a correr:\n`
      );
      for (const p of problems) console.error(`  - ${p}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${LOG} Pre-flight limpio: ninguna colisión detectada.`);

    // --- 4. Reescribir las filas ----------------------------------------
    let gradesUpdated = 0;
    let assignmentsUpdated = 0;

    for (const [schoolId, catalog] of catalogBySchool.entries()) {
      for (const [, subjectDoc] of catalog.entries()) {
        // Todas las grafías de esta escuela que normalizan a esta materia.
        const variants = [...(namesBySchool.get(schoolId) || [])].filter(
          (n) => normalizeName(n) === normalizeName(subjectDoc.name)
        );
        if (variants.length === 0) continue;

        const filter = {
          school: schoolId,
          subject: { $in: variants },
          subject_id: { $exists: false },
        };
        const update = {
          $set: { subject_id: subjectDoc._id },
          $unset: { subject: "" },
        };

        if (DRY_RUN) {
          const [g, t] = await Promise.all([
            Grade.countDocuments(filter),
            TeacherSubject.countDocuments(filter),
          ]);
          if (g || t) {
            console.log(
              `${LOG}   would update ${g} grades + ${t} assignments → "${subjectDoc.name}"`
            );
          }
          continue;
        }

        const [gRes, tRes] = await Promise.all([
          Grade.updateMany(filter, update),
          TeacherSubject.updateMany(filter, update),
        ]);
        gradesUpdated += gRes.modifiedCount || 0;
        assignmentsUpdated += tRes.modifiedCount || 0;
      }
    }

    // --- 5. Índices ------------------------------------------------------
    if (!DRY_RUN) {
      await dropIndexIfExists(Grade, "uniq_enrollment_subject_period");
      await dropIndexIfExists(Grade, "uniq_enrollment_subject_grading_period");
      await dropIndexIfExists(TeacherSubject, "uniq_teacher_subject_group_year");
      await Grade.syncIndexes();
      await TeacherSubject.syncIndexes();
      await Subject.syncIndexes();
      console.log(`${LOG} Índices sincronizados.`);
    }

    console.log(
      `${LOG} Listo. Grades migrados: ${gradesUpdated}, TeacherSubjects migrados: ${assignmentsUpdated}.`
    );
  } finally {
    await mongoose.disconnect();
    console.log(`${LOG} Desconectado.`);
  }
}

main().catch((err) => {
  console.error(`${LOG} FALLÓ:`, err);
  process.exit(1);
});
