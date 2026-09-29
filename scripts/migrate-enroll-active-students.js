// Migración one-shot no-destructiva: matricula en el ciclo escolar activo
// (`School.current_school_year_id`) a todos los Students activos que
// todavía no tengan un `Enrollment` con `cycle_status: "enrolled"` para
// ese ciclo.
//
// Es idempotente (skipa los que ya tienen enrollment) y trae `DRY_RUN=1`
// para previsualizar antes de escribir.
//
// Contexto: la BD puede llegar con 469+ Students `status: "active"` pero
// sin `Enrollment` para el ciclo activo, lo que hace que la pantalla de
// "alumnado" (que filtra via /api/enrollments) los oculte. Este script
// los vincula usando su `current_group_id` (si pertenece al ciclo activo);
// los que no tengan grupo quedan con `group_id: null` (entran como
// "Sin grupo" en el frontend, igual que los que el admin creó hoy).
//
// Distribución de grupos:
//   - Si el `current_group_id` ya apunta a un Group del ciclo activo →
//     se respeta.
//   - Si no pertenece al ciclo activo (p.ej. quedó del año anterior) →
//     se cae al primer grupo regular del grado del estudiante; si no
//     hay grado/grupo del estilo, queda null.
//
// Uso:
//   $ DRY_RUN=1 node scripts/migrate-enroll-active-students.js
//   $ NODE_ENV=development node scripts/migrate-enroll-active-students.js

require("/Users/aldogonzalez/Documents/Proyectos/eduk-control/eduk-control-backend/node_modules/dotenv").config({
  path: "/Users/aldogonzalez/Documents/Proyectos/eduk-control/eduk-control-backend/.env",
});
const mongoose = require("mongoose");
const School = require("../models/School.model");
const Student = require("../models/Student.model");
const Group = require("../models/Group.model");
const Enrollment = require("../models/Enrollment.model");

const DRY_RUN = process.env.DRY_RUN === "1";

(async () => {
  await mongoose.connect("mongodb://127.0.0.1:27017/eduk_control");

  const schools = await School.find({ isActive: true }).select("_id name current_school_year_id");
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const school of schools) {
    const schoolId = school._id;
    const yearId = school.current_school_year_id;
    if (!yearId) {
      console.log(
        `[skip school=${school.name}] sin current_school_year_id — saltando`
      );
      continue;
    }
    console.log(`\n=== Escuela ${school.name} (${schoolId}) ciclo ${yearId} ===`);

    // Grupos del ciclo activo (regulares primero, son los que se
    // distribuyen al alumno en "sin grupo").
    const groupsThisYear = await Group.find({
      school: schoolId,
      school_year_id: yearId,
    }).select("_id grade section type");
    const groupsByGrade = {};
    for (const g of groupsThisYear) {
      if (g.type !== "regular") continue;
      groupsByGrade[g.grade] = groupsByGrade[g.grade] || [];
      groupsByGrade[g.grade].push(g._id);
    }
    console.log(
      `  grupos regulares por grado:`,
      Object.fromEntries(
        Object.entries(groupsByGrade).map(([g, ids]) => [g, ids.length])
      )
    );

    // Estudiantes activos
    const enrolledIds = await Enrollment.distinct("student_id", {
      school: schoolId,
      school_year_id: yearId,
      cycle_status: "enrolled",
    });
    const students = await Student.find({
      school: schoolId,
      status: "active",
      _id: { $nin: enrolledIds },
    }).populate("current_group_id", "grade section school_year_id type");
    console.log(`  alumnos a evaluar: ${students.length}`);

    let createdHere = 0;
    let skippedHere = 0;
    const talliesByGrade = { "": 0 };

    for (const s of students) {
      // Resolver group_id: respetar current_group_id solo si pertenece
      // al ciclo activo; si no, primer grupo regular del grado del
      // Student (necesita populate). Si no hay grado/grupo, null.
      let groupId = null;
      let viaCurrent = false;
      if (
        s.current_group_id &&
        s.current_group_id.school_year_id?.toString() === yearId.toString() &&
        s.current_group_id.type === "regular"
      ) {
        groupId = s.current_group_id._id;
        viaCurrent = true;
      } else {
        // Intentar deducir grado por controlNumber (5 primeros dígitos
        // del controlNumber son YY + 2 más). Si no, dejar null.
        let grade = null;
        if (typeof s.controlNumber === "string") {
          // Formato: YY (2) + SHIFT (1) + CCT4 (4) + CONSEC (3) = 10.
          // El grado no está codificado; el shift sí. Sin info de grado
          // en el controlNumber, caemos a null.
        }
        // Como no tenemos campo directo de grado, dejamos null si el
        // current_group_id no sirve. Esto es equivalente al estado
        // "Sin grupo" que el admin ajusta luego.
        groupId = null;
      }
      const gradeKey = (s.current_group_id?.grade ?? "") + "";
      talliesByGrade[gradeKey] = (talliesByGrade[gradeKey] || 0) + 1;

      if (DRY_RUN) {
        // eslint-disable-next-line no-console
        console.log(
          `  [dry] ${s.controlNumber || s.curp} ${s.first_name} ${s.last_name} → group=${groupId || "(null)"} viaCurrent=${viaCurrent}`
        );
      } else {
        await Enrollment.create({
          school: schoolId,
          school_year_id: yearId,
          student_id: s._id,
          group_id: groupId,
          cycle_status: "enrolled",
          enrollment_number: s.controlNumber || null,
        });
        createdHere++;
      }
    }
    if (DRY_RUN) {
      console.log(`  [dry] distribución por grado:`, talliesByGrade);
    }
    totalCreated += createdHere;
    totalSkipped += skippedHere;
    if (!DRY_RUN) {
      console.log(`  → creados: ${createdHere}`);
    }
  }

  console.log(`\nTotal${DRY_RUN ? " (dry-run)" : ""}: creados=${totalCreated} skipped=${totalSkipped}`);
  await mongoose.disconnect();
  process.exit(0);
})();
