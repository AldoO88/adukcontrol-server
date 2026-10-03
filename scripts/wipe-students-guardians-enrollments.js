// scripts/wipe-students-guardians-enrollments.js
// ---------------------------------------------------------------------
// Borra alumnos, guardians, enrollments y (opcional) usuarios tutor de
// una escuela. Pensado para arrancar de cero antes de re-importar un
// Excel corregido cuando un import previo dejó basura (p. ej. alumnos
// sin controlNumber porque les faltó la columna `grupo`).
//
// Uso típico:
//
//   DRY_RUN=1 SCHOOL_ID=<oid> WIPE_TUTOR_USERS=1 \
//     node scripts/wipe-students-guardians-enrollments.js
//
//   DRY_RUN=0 SCHOOL_ID=<oid> WIPE_TUTOR_USERS=1 \
//     node scripts/wipe-students-guardians-enrollments.js
//
// Flags:
//   DRY_RUN=1             Reporta qué haría y NO escribe (default ON).
//   DRY_RUN=0             Aplica los cambios.
//   SCHOOL_ID=<oid>       Limita el alcance a una escuela (recomendado).
//   WIPE_TUTOR_USERS=1    Además borra los User role=tutor de la escuela.
//                         Sin este flag, los tutor Users se conservan y el
//                         re-import los reusa por `{school, phoneNumber}`.
//                         Con este flag, todos los tutores tendrán que
//                         volver a hacer OTP de activación.
//
// Requiere MONGO_URI en el entorno.
//
// NOTA: este script NO toca schools, schoolyears, groups, schedules,
// notas, calificaciones, ni staff (admin/registrar/teacher). Solo
// alumnos + su ciclo + sus tutores (opcional). Antes de correr, te
// recomendamos hacer backup local con mongodump o con un script propio
// (los datos borrados no se pueden restaurar desde el control language).

require("dotenv").config();

const mongoose = require("mongoose");

const DRY_RUN = process.env.DRY_RUN !== "0" && process.env.DRY_RUN !== "false";
const SCHOOL_ID = process.env.SCHOOL_ID || null;
const WIPE_TUTOR_USERS = process.env.WIPE_TUTOR_USERS === "1";
const LOG = "[wipe-students-guardians-enrollments]";

const main = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error(`${LOG} ERROR: MONGO_URI no está definido en el entorno.`);
    process.exit(1);
  }

  await mongoose.connect(uri);

  try {
    console.log(`${LOG} === Wipe de alumnos / guardians / enrollments ===`);
    console.log(`${LOG} DRY_RUN:          ${DRY_RUN}`);
    console.log(`${LOG} SCHOOL_ID:        ${SCHOOL_ID || "(TODAS las escuelas)"}`);
    console.log(`${LOG} WIPE_TUTOR_USERS: ${WIPE_TUTOR_USERS}`);

    if (!SCHOOL_ID) {
      console.error(`${LOG} ERROR: pasá SCHOOL_ID=<oid> para limitar el wipe. Es destructivo y no se puede deshacer.`);
      process.exit(1);
    }

    const school = new mongoose.Types.ObjectId(SCHOOL_ID);
    const schoolFilter = { school };

    // Conteos previos.
    const counts = {
      students: await mongoose.connection.db.collection("students").countDocuments(schoolFilter),
      enrollments: await mongoose.connection.db.collection("enrollments").countDocuments(schoolFilter),
      guardians: await mongoose.connection.db.collection("guardians").countDocuments(schoolFilter),
      users_tutor: await mongoose.connection.db
        .collection("users")
        .countDocuments({ ...schoolFilter, role: "tutor" }),
    };
    console.log("");
    console.log(`${LOG} Conteos previos:`);
    console.log(`${LOG}   students:    ${counts.students}`);
    console.log(`${LOG}   enrollments: ${counts.enrollments}`);
    console.log(`${LOG}   guardians:   ${counts.guardians}`);
    console.log(`${LOG}   users tutor: ${counts.users_tutor}${WIPE_TUTOR_USERS ? "  (a borrar)" : "  (NO se borran)"}`);

    const totalToDelete =
      counts.students + counts.enrollments + counts.guardians + (WIPE_TUTOR_USERS ? counts.users_tutor : 0);

    if (totalToDelete === 0) {
      console.log("");
      console.log(`${LOG} Nada que borrar. Saliendo.`);
      return;
    }

    console.log("");
    console.log(`${LOG} Total documentos a borrar: ${totalToDelete}`);

    if (DRY_RUN) {
      console.log("");
      console.log(`${LOG} DRY RUN: no se modificó la DB.`);
      console.log(`${LOG} Para aplicar de verdad:`);
      console.log(
        `${LOG}   DRY_RUN=0 SCHOOL_ID=${SCHOOL_ID} WIPE_TUTOR_USERS=${
          WIPE_TUTOR_USERS ? "1" : "0"
        } node scripts/wipe-students-guardians-enrollments.js`
      );
      return;
    }

    console.log("");
    console.log(`${LOG} Aplicando borrado en cascada (students → enrollments → guardians → users tutor)…`);

    // Orden importante: students primero (rompe los student_id refs),
    // luego enrollments (rompe student_id refs), luego guardians (rompe
    // students[]), y al final users tutor (rompe guardian.user_id).
    // Si no quedan docs de rollback o logs transaccionales, este orden
    // es seguro y no genera "constraint violations".

    let removed = 0;

    if (counts.students > 0) {
      const r = await mongoose.connection.db.collection("students").deleteMany(schoolFilter);
      removed += r.deletedCount;
      console.log(`${LOG}   students borrados:    ${r.deletedCount}`);
    }
    if (counts.enrollments > 0) {
      const r = await mongoose.connection.db.collection("enrollments").deleteMany(schoolFilter);
      removed += r.deletedCount;
      console.log(`${LOG}   enrollments borrados: ${r.deletedCount}`);
    }
    if (counts.guardians > 0) {
      const r = await mongoose.connection.db.collection("guardians").deleteMany(schoolFilter);
      removed += r.deletedCount;
      console.log(`${LOG}   guardians borrados:   ${r.deletedCount}`);
    }
    if (WIPE_TUTOR_USERS && counts.users_tutor > 0) {
      const r = await mongoose.connection.db
        .collection("users")
        .deleteMany({ ...schoolFilter, role: "tutor" });
      removed += r.deletedCount;
      console.log(`${LOG}   users tutor borrados: ${r.deletedCount}`);
    }

    console.log("");
    console.log(`${LOG} Total eliminado: ${removed}`);
    console.log(`${LOG} Wipe aplicado.`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((err) => {
  console.error(`${LOG} ERROR FATAL:`, err);
  process.exit(1);
});