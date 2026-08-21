// Configuración del cronjob de auto-ausencias
// Marca como absent a los alumnos que no pasaron por el lector biométrico
// después del corte de gracia (startTime + gracePeriodMinutes).
//
// Se ejecuta de lunes a viernes a las 08:00 (hora del servidor).
// Configuración: CRON_ABSENCE_ENABLED, CRON_ABSENCE_SCHEDULE en .env.
//
// Nota: el timezone del cron se configura con la variable de entorno
// CRON_TZ (ej: CRON_TZ=America/Mexico_City). Si no está configurada,
// se usa la zona horaria del servidor.
const cron = require("node-cron");
const mongoose = require("mongoose");
const School = require("../models/School.model");
const attendanceService = require("../services/attendance.service");

let scheduledTask = null;

// Ejecuta el marcado de ausencias para TODAS las escuelas activas.
const runAbsenceMarking = async () => {
  const startTime = Date.now();
  console.log("[cron][absences] Starting absence marking run...");

  try {
    const schools = await School.find({ isActive: true })
      .select("name cct current_school_year_id")
      .lean();

    if (schools.length === 0) {
      console.log("[cron][absences] No active schools found. Skipping.");
      return;
    }

    let totalMarked = 0;
    let totalSkipped = 0;

    for (const school of schools) {
      if (!school.current_school_year_id) {
        console.log(
          `[cron][absences] School ${school.name || school._id}: no active school year, skipping.`
        );
        continue;
      }

      try {
        const result = await attendanceService.markAbsencesForSchool(
          school._id,
          school.current_school_year_id
        );
        totalMarked += result.marked;
        totalSkipped += result.skipped;
      } catch (err) {
        console.error(
          `[cron][absences] Error processing school ${school.name || school._id}: ${err.message}`
        );
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[cron][absences] Run completed in ${elapsed}s. Total: ${totalMarked} marked, ${totalSkipped} skipped across ${schools.length} school(s).`
    );
  } catch (err) {
    console.error(`[cron][absences] Fatal error: ${err.message}`);
  }
};

// Inicia el cronjob si está habilitado.
const startAbsenceCron = () => {
  const enabled = process.env.CRON_ABSENCE_ENABLED !== "false"; // default: true
  const schedule = process.env.CRON_ABSENCE_SCHEDULE || "0 8 * * 1-5"; // L-V 08:00

  if (!enabled) {
    console.log("[cron][absences] Disabled (CRON_ABSENCE_ENABLED=false).");
    return;
  }

  if (!cron.validate(schedule)) {
    console.error(
      `[cron][absences] Invalid cron schedule "${schedule}". Skipping.`
    );
    return;
  }

  // No arrancar si Mongo no está conectado
  if (mongoose.connection.readyState !== 1) {
    console.warn(
      "[cron][absences] MongoDB not connected. Deferring cron start..."
    );
    mongoose.connection.once("connected", () => {
      console.log("[cron][absences] MongoDB connected. Starting cron now.");
      _startTask(schedule);
    });
    return;
  }

  _startTask(schedule);
};

const _startTask = (schedule) => {
  scheduledTask = cron.schedule(schedule, runAbsenceMarking, {
    timezone: process.env.CRON_TZ || undefined,
  });
  console.log(
    `[cron][absences] Scheduled: "${schedule}" (tz: ${process.env.CRON_TZ || "server default"})`
  );
};

// Detiene el cronjob (útil para graceful shutdown).
const stopAbsenceCron = () => {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log("[cron][absences] Stopped.");
  }
};

module.exports = {
  startAbsenceCron,
  stopAbsenceCron,
  runAbsenceMarking,
};
