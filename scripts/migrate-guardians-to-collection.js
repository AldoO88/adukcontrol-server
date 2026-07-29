// scripts/migrate-guardians-to-collection.js
// Extrae los guardianes que aún estén embebidos como subdocs en Student.guardians
// y los migra a la colección Guardian propia. Sincroniza Student.guardians
// para que apunte a los ObjectIds de los nuevos Guardian documents.
//
// Uso:
//   node scripts/migrate-guardians-to-collection.js
//
// IMPORTANTE: hacer backup antes. Solo funciona si antes corriste
// scripts/migrate-to-multitenant.js (los Students deben tener school asignado).
// Si Student.guardians ya está poblado con ObjectIds (post-refactor), el script
// los detecta y no hace nada.

require("dotenv").config();

const mongoose = require("mongoose");
const Student = require("../models/Student.model");
const Guardian = require("../models/Guardian.model");

async function isAlreadyMigrated() {
  // Si Student.guardians tiene ObjectIds (no subdocs), ya está migrado
  const sample = await Student.findOne({ guardians: { $exists: true, $ne: [] } });
  if (!sample) return true; // sin guardianes, no hay nada que migrar
  // Si el primer elemento es string ObjectId, ya está migrado
  const first = sample.guardians[0];
  return typeof first === "string" || first instanceof mongoose.Types.ObjectId;
}

async function main() {
  console.log("[migrate-guards] Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    if (await isAlreadyMigrated()) {
      console.log(
        "[migrate-guards] Student.guardians ya son ObjectIds. Nada que migrar."
      );
      return;
    }

    console.log("[migrate-guards] Extrayendo guardianes embebidos...");
    const students = await Student.find({ "guardians.0": { $exists: true } });
    console.log(`[migrate-guards] ${students.length} estudiantes con guardianes`);

    let created = 0;
    let updated = 0;

    for (const student of students) {
      const newGuardianIds = [];
      for (const sub of student.guardians) {
        if (!sub || !sub.name) continue;

        // Buscar si ya existe un Guardian con este phone+school
        let guardian = await Guardian.findOne({
          school: student.school,
          phone: sub.phone,
        });

        if (!guardian) {
          guardian = await Guardian.create({
            school: student.school,
            name: sub.name,
            relationship: sub.relationship,
            phone: sub.phone,
            fcm_token: sub.fcm_token || null,
            students: [student._id],
          });
          created++;
        } else {
          // Ya existe: agregar este student si no está
          if (!guardian.students.map(String).includes(String(student._id))) {
            guardian.students.push(student._id);
            await guardian.save();
          }
        }

        newGuardianIds.push(guardian._id);
      }

      // Reemplazar guardians embebidos con ObjectIds
      student.guardians = newGuardianIds;
      await student.save();
      updated++;
    }

    console.log(`[migrate-guards] DONE.`);
    console.log(`  Guardians creados:  ${created}`);
    console.log(`  Students actualizados: ${updated}`);
  } catch (error) {
    console.error("[migrate-guards] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[migrate-guards] Disconnected");
  }
}

main();
