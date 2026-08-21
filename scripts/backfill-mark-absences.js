// scripts/backfill-mark-absences.js
// Marca ausencias automáticas para días pasados.
// Usa la misma lógica que el cronjob pero para una fecha específica.
//
// Uso:
//   node scripts/backfill-mark-absences.js                  # hoy
//   node scripts/backfill-mark-absences.js 2026-08-18       # un día específico
//   DRY_RUN=1 node scripts/backfill-mark-absences.js        # solo loguea
//
// IMPORTANTE: hacer backup antes de correr en producción.

require("dotenv").config();

const mongoose = require("mongoose");
const attendanceService = require("../services/attendance.service");
const School = require("../models/School.model");

async function main() {
  const isDryRun = process.env.DRY_RUN === "1";
  const targetDateArg = process.argv[2];

  console.log("[backfill-mark-absences] Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const targetDate = targetDateArg ? new Date(targetDateArg) : new Date();
    if (targetDateArg && Number.isNaN(targetDate.getTime())) {
      console.error(`[backfill-mark-absences] Invalid date: ${targetDateArg}`);
      process.exitCode = 1;
      return;
    }

    const dateStr = targetDate.toISOString().slice(0, 10);
    console.log(
      `[backfill-mark-absences] Target date: ${dateStr} (DRY_RUN: ${isDryRun})`
    );

    if (isDryRun) {
      console.log(
        "[backfill-mark-absences] DRY_RUN mode — no changes will be written."
      );
    }

    // Buscar todas las escuelas activas
    const schools = await School.find({ isActive: true })
      .select("name cct current_school_year_id")
      .lean();

    if (schools.length === 0) {
      console.log("[backfill-mark-absences] No active schools found.");
      return;
    }

    console.log(
      `[backfill-mark-absences] Found ${schools.length} active school(s).`
    );

    for (const school of schools) {
      if (!school.current_school_year_id) {
        console.log(
          `[backfill-mark-absences] School ${school.name || school._id}: no active school year, skipping.`
        );
        continue;
      }

      console.log(
        `[backfill-mark-absences] Processing school: ${school.name || school._id}`
      );

      if (isDryRun) {
        // En dry run, solo loguear qué se haría
        const { isSchoolDay } = require("../services/attendance.service");
        const dayCheck = await isSchoolDay(
          school._id,
          school.current_school_year_id,
          targetDate
        );
        if (!dayCheck.isSchoolDay) {
          console.log(
            `  ${dateStr} is not a school day (${dayCheck.reason}). Would skip.`
          );
          continue;
        }
        console.log(`  ${dateStr} is a school day. Would process absences.`);
        continue;
      }

      try {
        const result = await attendanceService.markAbsencesForSchool(
          school._id,
          school.current_school_year_id,
          targetDate
        );
        console.log(
          `  Result: ${result.marked} marked, ${result.skipped} skipped`
        );
      } catch (err) {
        console.error(
          `  Error processing school ${school.name || school._id}: ${err.message}`
        );
      }
    }

    console.log("[backfill-mark-absences] DONE.");
  } catch (error) {
    console.error("[backfill-mark-absences] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[backfill-mark-absences] Disconnected");
  }
}

main();
