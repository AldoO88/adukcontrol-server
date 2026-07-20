// scripts/migrate-to-multitenant.js
// Script de migración one-shot para adaptar la base de datos existente a la
// arquitectura multi-tenant. Asigna todos los registros huérfanos a una
// escuela "Default" y sincroniza los índices únicos compuestos.
//
// Uso:
//   node scripts/migrate-to-multitenant.js
//
// IMPORTANTE: hacer backup de la DB antes de ejecutar.
//   mongodump --uri="$MONGO_URI" --out=./backup-pre-multitenant

require("dotenv").config();

const mongoose = require("mongoose");
const School = require("../models/School.model");
const User = require("../models/User.model");
const Student = require("../models/Student.model");
const Group = require("../models/Group.model");
const Enrollment = require("../models/Enrollment.model");
const AttendanceLog = require("../models/AttendanceLog.model");

const DEFAULT_CCT = "DEFAULT-MIGRATION";
const DEFAULT_NAME = "Default School (Migrated Data)";

async function ensureDefaultSchool() {
  let school = await School.findOne({ cct: DEFAULT_CCT });
  if (!school) {
    school = await School.create({
      name: DEFAULT_NAME,
      cct: DEFAULT_CCT,
      isActive: true,
    });
    console.log(`[migrate] Created default school: ${school._id}`);
  } else {
    console.log(`[migrate] Reusing existing default school: ${school._id}`);
  }
  return school;
}

async function assignSchoolToCollection(Model, schoolId, label) {
  // Asignar a todos los registros que no tengan school
  const result = await Model.updateMany(
    { $or: [{ school: { $exists: false } }, { school: null }] },
    { $set: { school: schoolId } }
  );
  console.log(
    `[migrate] ${label}: matched=${result.matchedCount} modified=${result.modifiedCount}`
  );
}

async function syncAllIndexes() {
  // syncIndexes crea los índices nuevos y elimina los viejos que ya no están
  // en el esquema. Crítico para que los uniques compuestos entren en vigor.
  console.log("[migrate] Syncing indexes (this may drop old single-field uniques)...");
  await User.syncIndexes();
  await Student.syncIndexes();
  await Group.syncIndexes();
  await Enrollment.syncIndexes();
  await AttendanceLog.syncIndexes();
  console.log("[migrate] Indexes synced");
}

async function main() {
  console.log("[migrate] Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const school = await ensureDefaultSchool();
    const schoolId = school._id;

    await assignSchoolToCollection(User, schoolId, "User");
    await assignSchoolToCollection(Student, schoolId, "Student");
    await assignSchoolToCollection(Group, schoolId, "Group");
    await assignSchoolToCollection(Enrollment, schoolId, "Enrollment");
    await assignSchoolToCollection(AttendanceLog, schoolId, "AttendanceLog");

    await syncAllIndexes();

    console.log("\n[migrate] DONE. Summary:");
    const counts = await Promise.all([
      User.countDocuments({ school: schoolId }),
      Student.countDocuments({ school: schoolId }),
      Group.countDocuments({ school: schoolId }),
      Enrollment.countDocuments({ school: schoolId }),
      AttendanceLog.countDocuments({ school: schoolId }),
    ]);
    console.log(`  Users assigned:      ${counts[0]}`);
    console.log(`  Students assigned:   ${counts[1]}`);
    console.log(`  Groups assigned:     ${counts[2]}`);
    console.log(`  Enrollments assigned:${counts[3]}`);
    console.log(`  Attendance assigned: ${counts[4]}`);
  } catch (error) {
    console.error("[migrate] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[migrate] Disconnected");
  }
}

main();
