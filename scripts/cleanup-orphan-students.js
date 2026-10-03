// scripts/cleanup-orphan-students.js
// ---------------------------------------------------------------------
// Limpia referencias huérfanas a Student en colecciones que el
// DELETE /api/students/:studentId no toca (no hay cascada en el modelo).
//
// Uso típico: el operador borró alumnos por error y quiere re-importarlos
// sin acumular basura en Enrollments / Guardian.students[].
//
// Qué hace:
//   - Eliminar Enrollments cuyo student_id ya no existe en students.
//   - Sacar ids muertos de Guardian.students[]  (deja vivos intactos).
//
// Si vuelve a haber documentos huérfanos después del cleanup, la causa
// probable es que se importó el Excel antes de correr este script.
//
// Flags:
//   DRY_RUN=1   Reporta qué haría y NO escribe nada (default).
//   DRY_RUN=0   Aplica los cambios.
//   SCHOOL_ID=…  Limita el alcance a una escuela (opcional, recomendado).
//
// Uso:
//   DRY_RUN=1 SCHOOL_ID=… node scripts/cleanup-orphan-students.js
//   DRY_RUN=0 SCHOOL_ID=… node scripts/cleanup-orphan-students.js
//
// Requiere MONGO_URI en el entorno.

require("dotenv").config();

const mongoose = require("mongoose");
const Student = require("../models/Student.model");
const Enrollment = require("../models/Enrollment.model");
const Guardian = require("../models/Guardian.model");

const DRY_RUN = process.env.DRY_RUN !== "0" && process.env.DRY_RUN !== "false";
const SCHOOL_ID = process.env.SCHOOL_ID || null;
const LOG = "[cleanup-orphan-students]";

const main = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error(`${LOG} ERROR: MONGO_URI no está definido en el entorno.`);
    process.exit(1);
  }

  await mongoose.connect(uri);

  try {
    console.log(`${LOG} === Cleanup de referencias huérfanas a Student ===`);
    console.log(`${LOG} DRY_RUN: ${DRY_RUN}`);
    console.log(`${LOG} SCHOOL_ID (filtro): ${SCHOOL_ID || "(todas)"}`);

    // Construir el filtro base (con tenant si corresponde).
    const baseFilter = SCHOOL_ID ? { school: SCHOOL_ID } : {};

    // Set vivo: ids de students que SÍ existen en la DB (filtrado por
    // escuela si se pasó SCHOOL_ID, así no se marcan como muertas refs
    // de otras escuelas).
    const aliveStudents = await Student.find(baseFilter).select("_id").lean();
    const alive = new Set(aliveStudents.map((s) => String(s._id)));
    console.log(`${LOG} Students vivos: ${alive.size}`);

    const isDead = (id) => id && !alive.has(String(id));

    // 1. Enrollments huérfanos.
    const enrollmentFilter = SCHOOL_ID ? { school: SCHOOL_ID } : {};
    const enrollments = await Enrollment.find(enrollmentFilter)
      .select("_id student_id group_id school_year_id cycle_status")
      .lean();
    const deadEnrollments = enrollments.filter((e) => isDead(e.student_id));
    console.log("");
    console.log(`${LOG} Enrollments totales: ${enrollments.length}`);
    console.log(`${LOG} Enrollments con student_id inexistente: ${deadEnrollments.length}`);
    if (deadEnrollments.length > 0) {
      console.log(`${LOG}   Ejemplos (primeros 5):`);
      deadEnrollments.slice(0, 5).forEach((e) => {
        console.log(
          `${LOG}     - enrollment ${e._id} → student ${e.student_id} (cycle_status=${e.cycle_status})`
        );
      });
      if (deadEnrollments.length > 5) {
        console.log(`${LOG}     ... +${deadEnrollments.length - 5} mas`);
      }
    }

    // 2. Guardian.students[] con ids muertos.
    const guardianFilter = SCHOOL_ID ? { school: SCHOOL_ID } : {};
    const guardians = await Guardian.find(guardianFilter)
      .select("_id name lastname phone students")
      .lean();
    const guardiansWithDeadRefs = guardians
      .map((g) => {
        const deadRefs = (g.students || []).filter(isDead);
        return { g, deadRefs };
      })
      .filter((x) => x.deadRefs.length > 0);
    const totalDeadRefs = guardiansWithDeadRefs.reduce(
      (acc, x) => acc + x.deadRefs.length,
      0
    );
    console.log("");
    console.log(`${LOG} Guardians totales: ${guardians.length}`);
    console.log(
      `${LOG} Guardians con refs muertas en Guard.students[]: ${guardiansWithDeadRefs.length} (${totalDeadRefs} refs a sacar)`
    );
    if (guardiansWithDeadRefs.length > 0) {
      console.log(`${LOG}   Ejemplos (primeros 5):`);
      guardiansWithDeadRefs.slice(0, 5).forEach(({ g, deadRefs }) => {
        console.log(
          `${LOG}     - ${g.name} ${g.lastname || ""} (${g.phone}) → sacar ${deadRefs.length} id(s)`
        );
      });
      if (guardiansWithDeadRefs.length > 5) {
        console.log(`${LOG}     ... +${guardiansWithDeadRefs.length - 5} mas`);
      }
    }

    // 3. Reportar refs muertas en Student.guardians[] — pero como el
    // Student ya está borrado, no hay de dónde sacar. No hay nada
    // que limpiar en ese lado: el array vivía dentro del Student
    // borrado.

    // Resumen y decisión.
    console.log("");
    console.log(`${LOG} === Resumen ===`);
    console.log(`${LOG} Enrollments a eliminar:           ${deadEnrollments.length}`);
    console.log(
      `${LOG} Guardian.students[] refs a purgar: ${totalDeadRefs}`
    );

    if (deadEnrollments.length === 0 && totalDeadRefs === 0) {
      console.log(`${LOG} Nada que limpiar. Saliendo.`);
      return;
    }

    if (DRY_RUN) {
      console.log("");
      console.log(`${LOG} DRY RUN: no se modificó la DB.`);
      console.log(`${LOG} Para aplicar de verdad:`);
      console.log(
        `${LOG}   DRY_RUN=0 SCHOOL_ID=${SCHOOL_ID || "<escuado>"} node scripts/cleanup-orphan-students.js`
      );
      return;
    }

    // Aplicar.
    console.log("");
    console.log(`${LOG} Aplicando cambios…`);

    let removedEnrollments = 0;
    if (deadEnrollments.length > 0) {
      const ids = deadEnrollments.map((e) => e._id);
      const res = await Enrollment.deleteMany({ _id: { $in: ids } });
      removedEnrollments = res.deletedCount;
      console.log(`${LOG}   Enrollments eliminados: ${removedEnrollments}`);
    }

    let purgedRefs = 0;
    let purgedGuardians = 0;
    for (const { g, deadRefs } of guardiansWithDeadRefs) {
      const res = await Guardian.updateOne(
        { _id: g._id },
        { $pull: { students: { $in: deadRefs } } }
      );
      if (res.modifiedCount > 0) {
        purgedGuardians++;
        purgedRefs += deadRefs.length;
      }
    }
    console.log(
      `${LOG}   Guardian.students[] purgados: ${purgedRefs} refs en ${purgedGuardians} tutores`
    );

    console.log("");
    console.log(`${LOG} Cleanup aplicado.`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((err) => {
  console.error(`${LOG} ERROR FATAL:`, err);
  process.exit(1);
});