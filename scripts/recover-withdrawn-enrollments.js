/**
 * recover-withdrawn-enrollments.js
 *
 * Migra las inscripciones que fueron eliminadas con DELETE físico durante
 * el flujo de "Dar de Baja" para recrearlas con cycle_status: "withdrawn".
 *
 * Lógica: un alumno que NO tiene inscripción en el ciclo actual pero SÍ
 * tiene un grupo asignado (current_group_id) que pertenece al ciclo,
 * fue dado de baja y necesita una inscripción "withdrawn".
 *
 * Uso:
 *   DRY_RUN=1 node scripts/recover-withdrawn-enrollments.js
 *   node scripts/recover-withdrawn-enrollments.js
 *
 * Requiere env vars: MONGO_URI, SCHOOL_ID, SCHOOL_YEAR_ID
 */

require("dotenv").config();

const mongoose = require("mongoose");
const Student = require("../models/Student.model");
const Enrollment = require("../models/Enrollment.model");
const Group = require("../models/Group.model");
const SchoolYear = require("../models/SchoolYear.model");

const DRY_RUN = process.env.DRY_RUN === "1";
const LOG = "[recover-withdrawn]";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`${LOG} Conectado a MongoDB`);

  const schoolId = process.env.SCHOOL_ID;
  const schoolYearId = process.env.SCHOOL_YEAR_ID;

  if (!schoolId || !schoolYearId) {
    console.error(`${LOG} ERROR: Debes definir SCHOOL_ID y SCHOOL_YEAR_ID en .env o como variable de entorno.`);
    process.exit(1);
  }

  console.log(`${LOG} School: ${schoolId}`);
  console.log(`${LOG} SchoolYear: ${schoolYearId}`);
  if (DRY_RUN) console.log(`${LOG} *** MODO DRY_RUN — no se escribirá nada ***`);

  // 1. Verificar que el ciclo existe
  const year = await SchoolYear.findOne({ _id: schoolYearId, school: schoolId });
  if (!year) {
    console.error(`${LOG} ERROR: No se encontró el ciclo escolar ${schoolYearId} para la escuela ${schoolId}.`);
    process.exit(1);
  }
  console.log(`${LOG} Ciclo: ${year.name}`);

  // 2. Obtener IDs de grupos del ciclo actual
  const groupIds = await Group.find({ school_year_id: schoolYearId, school: schoolId })
    .distinct("_id");
  console.log(`${LOG} Grupos del ciclo: ${groupIds.length}`);

  // 3. Obtener inscripciones existentes del ciclo
  const existingEnrollments = await Enrollment.find({
    school_year_id: schoolYearId,
    school: schoolId,
  }).distinct("student_id");
  const enrolledStudentIds = new Set(existingEnrollments.map(String));
  console.log(`${LOG} Alumnos con inscripción en el ciclo: ${enrolledStudentIds.size}`);

  // 4. Buscar alumnos que:
  //    - Tienen school = schoolId
  //    - current_group_id apunta a un grupo de ESTE ciclo
  //    - NO tienen inscripción en este ciclo
  const candidates = await Student.find({
    school: schoolId,
    current_group_id: { $in: groupIds },
  }).lean();

  const needsRecovery = candidates.filter((s) => !enrolledStudentIds.has(String(s._id)));
  console.log(`${LOG} Alumnos que necesitan inscripción "withdrawn": ${needsRecovery.length}`);

  if (needsRecovery.length === 0) {
    console.log(`${LOG} No hay nada que migrar.`);
    return;
  }

  // 5. Crear inscripciones withdrawn
  let created = 0;
  for (const student of needsRecovery) {
    const groupDoc = await Group.findById(student.current_group_id).lean();
    const groupYearId = groupDoc ? String(groupDoc.school_year_id) : null;

    // Sanity: el grupo debe pertenecer al ciclo que estamos migrando
    if (groupYearId !== String(schoolYearId)) {
      console.log(`${LOG} SKIP: ${student.first_name} ${student.last_name} — grupo no pertenece al ciclo`);
      continue;
    }

    const enrollmentData = {
      student_id: student._id,
      school_year_id: schoolYearId,
      group_id: student.current_group_id,
      cycle_status: "withdrawn",
      school: schoolId,
    };

    console.log(`${LOG}   → ${student.first_name} ${student.last_name} (${student.controlNumber || "?"})`);

    if (!DRY_RUN) {
      await Enrollment.create(enrollmentData);
    }
    created++;
  }

  console.log(`${LOG} --- Resumen ---`);
  console.log(`${LOG} Inscripciones ${DRY_RUN ? "que se crearían" : "creadas"}: ${created}`);
}

main()
  .catch(async (err) => {
    console.error(`${LOG} ERROR FATAL:`, err);
    await mongoose.disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log(`${LOG} Desconectado de MongoDB`);
  });
