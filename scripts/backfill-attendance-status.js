// scripts/backfill-attendance-status.js
// Recorre todos los AttendanceLog con event_type "entry" y status null,
// y computa el status (on_time / late) comparando event_time con el
// SchoolShift startTime del grupo del alumno.
//
// Uso:
//   node scripts/backfill-attendance-status.js             # ejecuta
//   DRY_RUN=1 node scripts/backfill-attendance-status.js  # solo loguea
//
// IMPORTANTE: hacer backup antes.

require("dotenv").config();

const mongoose = require("mongoose");
const AttendanceLog = require("../models/AttendanceLog.model");
const Student = require("../models/Student.model");
const Group = require("../models/Group.model");
const SchoolShift = require("../models/SchoolShift.model");

const toMinutes = (hhmm) => {
  if (typeof hhmm !== "string" || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(hhmm))
    return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

async function main() {
  const isDryRun = process.env.DRY_RUN === "1";

  console.log("[backfill-attendance-status] Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    // Buscar todos los entry logs sin status
    const logs = await AttendanceLog.find({
      event_type: "entry",
      $or: [{ status: { $exists: false } }, { status: null }],
    })
      .select("student_id event_time school")
      .lean();

    if (logs.length === 0) {
      console.log(
        "[backfill-attendance-status] No entry logs without status. Nothing to do."
      );
      return;
    }

    console.log(
      `[backfill-attendance-status] Found ${logs.length} entry log(s) without status.`
    );

    // Cachear shifts por escuela+ciclo para no repetir queries
    const shiftCache = new Map();
    let onTimeCount = 0;
    let lateCount = 0;
    let unresolvedCount = 0;

    for (const log of logs) {
      // Obtener el grupo del student
      const student = await Student.findById(log.student_id)
        .select("current_group_id")
        .lean();
      if (!student || !student.current_group_id) {
        unresolvedCount++;
        continue;
      }

      const group = await Group.findById(student.current_group_id)
        .select("shift school_year_id school")
        .lean();
      if (!group) {
        unresolvedCount++;
        continue;
      }

      const cacheKey = `${String(group.school)}:${String(group.school_year_id)}:${group.shift}`;
      let shiftMinutes = shiftCache.get(cacheKey);

      if (shiftMinutes === undefined) {
        const shift = await SchoolShift.findOne({
          school: group.school,
          school_year_id: group.school_year_id,
          shift: group.shift,
        })
          .select("startTime")
          .lean();

        shiftMinutes = shift ? toMinutes(shift.startTime) : null;
        shiftCache.set(cacheKey, shiftMinutes);
      }

      if (shiftMinutes === null) {
        unresolvedCount++;
        continue;
      }

      // Comparar event_time con shift startTime
      const offset = parseInt(
        process.env.ADMS_TZ_OFFSET_MINUTES || "0",
        10
      );
      const localDate = new Date(
        new Date(log.event_time).getTime() + offset * 60000
      );
      const eventMinutes =
        localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
      const status = eventMinutes <= shiftMinutes ? "on_time" : "late";

      if (status === "on_time") onTimeCount++;
      else lateCount++;

      if (!isDryRun) {
        await AttendanceLog.updateOne(
          { _id: log._id },
          { $set: { status } }
        );
      }
    }

    console.log("[backfill-attendance-status] DONE.");
    console.log(`  on_time: ${onTimeCount}`);
    console.log(`  late:    ${lateCount}`);
    console.log(`  unresolved (no status): ${unresolvedCount}`);
    if (isDryRun) {
      console.log("[backfill-attendance-status] DRY_RUN: no changes written.");
    }
  } catch (error) {
    console.error("[backfill-attendance-status] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[backfill-attendance-status] Disconnected");
  }
}

main();
