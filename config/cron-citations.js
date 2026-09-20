// =====================================================================
// config/cron-citations.js
// ---------------------------------------------------------------------
// Cron job de expiración automática para citatorios.
//
// Cada 30 minutos verifica citatorios con scheduledDate pasada:
//   - pending (sin confirmar) → expired
//   - confirmed (confirmado pero no asistió) → no_show
//
// Cron schedule: "*/30 8-18 * * 1-5" → cada 30 min, L-V, 08:00-18:00
// Configuración: CRON_CITATION_NO_SHOW_ENABLED en .env (default: true).
// =====================================================================

const cron = require("node-cron");
const mongoose = require("mongoose");
const Citation = require("../models/Citation.model");

let scheduledTask = null;

// =====================================================================
// FUNCIÓN PRINCIPAL
// =====================================================================
const runNoShowMarking = async () => {
  const startTime = Date.now();
  const now = new Date();

  console.log(`[cron][citation-no-show] Starting citation status run...`);

  try {
    // 1. Pending sin confirmar y fecha pasada → expired
    const expiredResult = await Citation.updateMany(
      {
        status: "pending",
        scheduledDate: { $lt: now },
      },
      {
        $set: { status: "expired" },
      }
    );

    // 2. Confirmados sin asistencia y fecha pasada → no_show
    const noShowResult = await Citation.updateMany(
      {
        status: "confirmed",
        scheduledDate: { $lt: now },
      },
      {
        $set: { status: "no_show" },
      }
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const total = expiredResult.modifiedCount + noShowResult.modifiedCount;
    console.log(
      `[cron][citation-no-show] Run completed in ${elapsed}s. ${expiredResult.modifiedCount} expired, ${noShowResult.modifiedCount} no_show.`
    );
  } catch (err) {
    console.error(`[cron][citation-no-show] Fatal error: ${err.message}`);
  }
};

// =====================================================================
// INICIO DEL CRON
// =====================================================================
const startCitationNoShowCron = async () => {
  const enabled = process.env.CRON_CITATION_NO_SHOW_ENABLED !== "false"; // default: true

  if (!enabled) {
    console.log("[cron][citation-no-show] Disabled (CRON_CITATION_NO_SHOW_ENABLED=false).");
    return;
  }

  // Cron: cada 30 minutos, L-V, 08:00-18:00
  const schedule = "*/30 8-18 * * 1-5";

  if (!cron.validate(schedule)) {
    console.error(
      `[cron][citation-no-show] Invalid cron schedule "${schedule}". Skipping.`
    );
    return;
  }

  // No arrancar si Mongo no está conectado
  if (mongoose.connection.readyState !== 1) {
    console.warn(
      "[cron][citation-no-show] MongoDB not connected. Deferring cron start..."
    );
    mongoose.connection.once("connected", () => {
      console.log("[cron][citation-no-show] MongoDB connected. Starting cron now.");
      _startTask(schedule);
    });
    return;
  }

  _startTask(schedule);
};

const _startTask = (schedule) => {
  scheduledTask = cron.schedule(schedule, runNoShowMarking, {
    timezone: process.env.CRON_TZ || undefined,
  });
  console.log(
    `[cron][citation-no-show] Scheduled: "${schedule}" (tz: ${process.env.CRON_TZ || "server default"})`
  );
};

// =====================================================================
// DETENCIÓN DEL CRON (graceful shutdown)
// =====================================================================
const stopCitationNoShowCron = () => {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log("[cron][citation-no-show] Stopped.");
  }
};

module.exports = {
  startCitationNoShowCron,
  stopCitationNoShowCron,
  runNoShowMarking,
};
