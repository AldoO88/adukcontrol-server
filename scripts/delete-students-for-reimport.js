// scripts/delete-students-for-reimport.js
// ---------------------------------------------------------------------
// Borra SOLO los alumnos de un grupo del ciclo activo de una escuela
// (más sus enrollments y las refs muertas en Guardian.students[]),
// dejando intactos tutores y cuentas de usuario. Pensado para usar
// entre un import que dejó basura (p.ej. alumnos sin controlNumber
// porque les faltó la columna `grupo` en el Excel) y la re-importación
// del Excel corregido.
//
// Conservar tutores y cuentas de tutor es importante: al re-importar,
// el import matchea tutores por `{school, phone}` y reutiliza los
// existentes; no necesitamos que vuelvan a pasar por OTP.
//
// Uso típico:
//
//   # preview (default):
//   DRY_RUN=1 SCHOOL_ID=<oid> GROUP_LABEL=2D \
//     MONGO_URI=<...> node scripts/delete-students-for-reimport.js
//
//   # aplicar:
//   DRY_RUN=0 SCHOOL_ID=<oid> GROUP_LABEL=2D \
//     MONGO_URI=<...> node scripts/delete-students-for-reimport.js
//
// Flags:
//   DRY_RUN=1         Reporta qué haría y NO escribe (default ON).
//   DRY_RUN=0         Aplica los cambios.
//   SCHOOL_ID=<oid>   Escuela (requerido).
//   GROUP_LABEL=<X>   Label del grupo en formato `${grado}${sección}`
//                     en mayúsculas, p.ej. `2D`. El script matchea
//                     contra el `Group.grade + section.toUpperCase()`
//                     de los grupos del ciclo activo de la escuela.
//
// Antes de borrar, dumpea JSON con los students y enrollments
// afectados a `_backup-reimport-<GROUP_LABEL>-<YYYYMMDD-HHMMSS>/`.
//
// Requiere MONGO_URI en el entorno.

require("dotenv").config();

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const DRY_RUN = process.env.DRY_RUN !== "0" && process.env.DRY_RUN !== "false";
const SCHOOL_ID = process.env.SCHOOL_ID || null;
const GROUP_LABEL = (process.env.GROUP_LABEL || "").trim().toUpperCase();
const LOG = "[delete-students-for-reimport]";

const dumpBackup = async (outDir, students, enrollments) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "students.json"),
    JSON.stringify(students, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(outDir, "enrollments.json"),
    JSON.stringify(enrollments, null, 2),
    "utf8"
  );
};

const main = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error(`${LOG} ERROR: MONGO_URI no está definido en el entorno.`);
    process.exit(1);
  }
  if (!SCHOOL_ID) {
    console.error(`${LOG} ERROR: pasá SCHOOL_ID=<oid>. Es destructivo.`);
    process.exit(1);
  }
  if (!GROUP_LABEL || GROUP_LABEL.length < 2) {
    console.error(
      `${LOG} ERROR: pasá GROUP_LABEL=<X> (formato grado+sección, p.ej. 2D).`
    );
    process.exit(1);
  }

  await mongoose.connect(uri);

  try {
    console.log(`${LOG} === Borrado de alumnos por grupo (re-import) ===`);
    console.log(`${LOG} DRY_RUN:    ${DRY_RUN}`);
    console.log(`${LOG} SCHOOL_ID:  ${SCHOOL_ID}`);
    console.log(`${LOG} GROUP_LABEL: ${GROUP_LABEL}`);

    const school = new mongoose.Types.ObjectId(SCHOOL_ID);
    const db = mongoose.connection.db;

    // Resolver el grupo del ciclo activo de la escuela.
    const schoolDoc = await db
      .collection("schools")
      .findOne({ _id: school }, { projection: { current_school_year_id: 1 } });
    if (!schoolDoc) {
      console.error(`${LOG} ERROR: escuela ${SCHOOL_ID} no existe.`);
      process.exit(1);
    }
    if (!schoolDoc.current_school_year_id) {
      console.error(
        `${LOG} ERROR: la escuela no tiene current_school_year_id configurado.`
      );
      process.exit(1);
    }
    const activeYear = schoolDoc.current_school_year_id;

    const groups = await db
      .collection("groups")
      .find({ school, school_year_id: activeYear }, { projection: { grade: 1, section: 1 } })
      .toArray();
    const matchGroup = groups.find(
      (g) => `${g.grade}${String(g.section).toUpperCase()}` === GROUP_LABEL
    );
    if (!matchGroup) {
      console.error(
        `${LOG} ERROR: no hay grupo con label "${GROUP_LABEL}" en el ciclo activo.`
      );
      console.error(
        `${LOG} Labels disponibles: ${groups
          .map((g) => `${g.grade}${String(g.section).toUpperCase()}`)
          .join(", ")}`
      );
      process.exit(1);
    }
    const groupId = matchGroup._id;
    console.log(`${LOG} Grupo: ${GROUP_LABEL} (${groupId})`);

    // Encontrar enrollments de este grupo en el ciclo activo.
    const enrollments = await db
      .collection("enrollments")
      .find(
        { school, group_id: groupId, school_year_id: activeYear },
        { projection: { student_id: 1, school_year_id: 1, group_id: 1, cycle_status: 1 } }
      )
      .toArray();
    const studentIds = enrollments.map((e) => e.student_id);

    if (studentIds.length === 0) {
      console.log(`${LOG} No hay enrollments en el grupo. Nada que borrar.`);
      return;
    }

    // Cargar los students completos para el backup.
    const students = await db
      .collection("students")
      .find(
        { _id: { $in: studentIds } },
        { projection: { controlNumber: 1, curp: 1, first_name: 1, last_name: 1, sex: 1, phone: 1, address: 1, current_group_id: 1, school: 1, guardians: 1 } }
      )
      .toArray();

    // Guardianes que tienen a estos students en `students[]` (para
    // hacer `$pull` de las refs muertas tras el borrado).
    const guardiansToClean = await db
      .collection("guardians")
      .find(
        { school, students: { $in: studentIds } },
        { projection: { _id: 1, phone: 1, students: 1 } }
      )
      .toArray();

    console.log("");
    console.log(`${LOG} Conteo previo:`);
    console.log(`${LOG}   students a borrar:     ${students.length}`);
    console.log(`${LOG}   enrollments a borrar:  ${enrollments.length}`);
    console.log(
      `${LOG}   guardians a actualizar: ${guardiansToClean.length} (solo $pull de refs muertas)`
    );
    const nullCn = students.filter((s) => !s.controlNumber).length;
    console.log(
      `${LOG}   students con controlNumber: ${students.length - nullCn} (de ${students.length})`
    );

    if (DRY_RUN) {
      console.log("");
      console.log(`${LOG} DRY RUN: no se modificó la DB.`);
      console.log(`${LOG} Para aplicar:`);
      console.log(
        `${LOG}   DRY_RUN=0 SCHOOL_ID=${SCHOOL_ID} GROUP_LABEL=${GROUP_LABEL} MONGO_URI=... node scripts/delete-students-for-reimport.js`
      );
      return;
    }

    // Backup antes de borrar.
    const ts = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..*/, "")
      .replace("T", "-");
    const outDir = path.join(
      process.cwd(),
      "_backup-reimport-" + GROUP_LABEL + "-" + ts
    );
    await dumpBackup(outDir, students, enrollments);
    console.log(`${LOG} Backup dump: ${outDir}`);

    console.log("");
    console.log(`${LOG} Aplicando borrado (enrollments → students → guardian refs)…`);

    let removed = 0;

    // 1) Enrollments.
    const enrRes = await db.collection("enrollments").deleteMany({
      school,
      group_id: groupId,
      school_year_id: activeYear,
    });
    removed += enrRes.deletedCount;
    console.log(`${LOG}   enrollments borrados: ${enrRes.deletedCount}`);

    // 2) Students.
    const stuRes = await db
      .collection("students")
      .deleteMany({ _id: { $in: studentIds }, school });
    removed += stuRes.deletedCount;
    console.log(`${LOG}   students borrados:    ${stuRes.deletedCount}`);

    // 3) Pull refs muertas de Guardian.students[] (conservamos los docs).
    let pulled = 0;
    for (const g of guardiansToClean) {
      const r = await db.collection("guardians").updateOne(
        { _id: g._id },
        { $pull: { students: { $in: studentIds } } }
      );
      pulled += r.modifiedCount || 0;
    }
    console.log(`${LOG}   guardian refs purgadas: ${pulled}`);

    console.log("");
    console.log(`${LOG} Total eliminado: ${removed} docs (tutores y tutor users intactos)`);
    console.log(`${LOG} Listo para re-importar el Excel corregido.`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((err) => {
  console.error(`${LOG} ERROR FATAL:`, err);
  process.exit(1);
});