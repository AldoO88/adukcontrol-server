// Configuración del cronjob de auto-ausencias (Nivel 3 — dinámico por turno)
// Cada 5 minutos verifica si ya se cumplió el cutoff de CADA turno
// (startTime + gracePeriodMinutes) y marca ausencias solo una vez por turno al día.
//
// Usa el campo `absenceMarkedAt` en SchoolShift para no repetir:
// si ya se marcó hoy, se salta. El server resetea absenceMarkedAt al iniciar.
//
// Cron schedule: "*/5 7-14 * * 1-5" → cada 5 min, L-V, 07:00-14:59
// Cubre matutino (cutoff típico ~07:35) y vespertino (cutoff típico ~13:05).
//
// Configuración: CRON_ABSENCE_ENABLED en .env (default: true).
const cron = require("node-cron");
const mongoose = require("mongoose");
const School = require("../models/School.model");
const SchoolShift = require("../models/SchoolShift.model");
const attendanceService = require("../services/attendance.service");

let scheduledTask = null;

// "HH:mm" → minutos desde medianoche
const toMinutes = (hhmm) => {
  if (typeof hhmm !== "string" || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(hhmm))
    return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Resetea absenceMarkedAt de AYER en todos los SchoolShifts activos.
// Se ejecuta una vez al iniciar el server para que el cron pueda marcar hoy.
const resetStaleMarkers = async () => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setUTCHours(23, 59, 59, 999);

    const result = await SchoolShift.updateMany(
      { absenceMarkedAt: { $lte: yesterday } },
      { $set: { absenceMarkedAt: null } }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `[cron][absences] Reset ${result.modifiedCount} stale absenceMarkedAt marker(s).`
      );
    }
  } catch (err) {
    console.error(`[cron][absences] Error resetting stale markers: ${err.message}`);
  }
};

// Verifica si la hora actual ya supera el cutoff de un turno específico.
// cutoff = startTime + gracePeriodMinutes (en minutos desde medianoche).
const hasCutoffBeenReached = (startTime, gracePeriodMinutes) => {
  const shiftMinutes = toMinutes(startTime);
  if (shiftMinutes === null) return false;

  const cutoffMinutes = shiftMinutes + (gracePeriodMinutes || 30);

  // Obtener hora actual en zona horaria del servidor
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return currentMinutes >= cutoffMinutes;
};

// Ejecuta el marcado de ausencias para TODAS las escuelas activas.
// Para cada escuela, consulta sus SchoolShifts activos y solo marca
// si el cutoff ya se cumplió y absenceMarkedAt no es de hoy.
const runAbsenceMarking = async () => {
  const startTime = Date.now();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  console.log(`[cron][absences] Starting absence marking run for ${todayStr}...`);

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
        // Buscar turnos activos de esta escuela
        const shifts = await SchoolShift.find({
          school: school._id,
          school_year_id: school.current_school_year_id,
          isActive: true,
        })
          .select("shift startTime gracePeriodMinutes name absenceMarkedAt")
          .lean();

        for (const shift of shifts) {
          // 1. ¿Ya se marcó hoy para este turno?
          if (shift.absenceMarkedAt) {
            const markedDate = new Date(shift.absenceMarkedAt).toISOString().slice(0, 10);
            if (markedDate === todayStr) {
              console.log(
                `[cron][absences] ${school.name || school._id} / ${shift.name}: already marked today, skipping.`
              );
              continue;
            }
          }

          // 2. ¿Ya se alcanzó el cutoff?
          if (!hasCutoffBeenReached(shift.startTime, shift.gracePeriodMinutes)) {
            console.log(
              `[cron][absences] ${school.name || school._id} / ${shift.name}: cutoff not reached yet (${shift.startTime} + ${shift.gracePeriodMinutes || 30}min), skipping.`
            );
            continue;
          }

          // 3. Marcar ausencias para este turno
          console.log(
            `[cron][absences] ${school.name || school._id} / ${shift.name}: marking absences...`
          );

          const result = await attendanceService.markAbsencesForSchool(
            school._id,
            school.current_school_year_id
          );

          totalMarked += result.marked;
          totalSkipped += result.skipped;

          // 4. Actualizar absenceMarkedAt
          await SchoolShift.updateOne(
            { _id: shift._id },
            { $set: { absenceMarkedAt: new Date() } }
          );

          console.log(
            `[cron][absences] ${school.name || school._id} / ${shift.name}: ${result.marked} marked, ${result.skipped} skipped.`
          );
        }
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
const startAbsenceCron = async () => {
  const enabled = process.env.CRON_ABSENCE_ENABLED !== "false"; // default: true

  if (!enabled) {
    console.log("[cron][absences] Disabled (CRON_ABSENCE_ENABLED=false).");
    return;
  }

  // Resetear markers stale al iniciar
  if (mongoose.connection.readyState === 1) {
    await resetStaleMarkers();
  } else {
    mongoose.connection.once("connected", async () => {
      console.log("[cron][absences] MongoDB connected. Resetting stale markers.");
      await resetStaleMarkers();
    });
  }

  // Cron: cada 5 minutos, L-V, 07:00-14:59
  const schedule = "*/5 7-14 * * 1-5";

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
