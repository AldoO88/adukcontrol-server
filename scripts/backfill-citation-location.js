// scripts/backfill-citation-location.js
// Rellena `location = "Dirección"` en todos los Citation que no tengan
// el campo seteado. Idempotente (no-op si todos ya tienen location).
//
// Necesario porque Citation.model.js#location es `required: true` y
// cualquier citatorio creado antes de este cambio quedaría con
// ValidationError al re-editarse.
//
// Uso:
//   node scripts/backfill-citation-location.js             # ejecuta
//   DRY_RUN=1 node scripts/backfill-citation-location.js  # solo loguea
//
// IMPORTANTE: hacer backup antes.

require("dotenv").config();

const mongoose = require("mongoose");
const Citation = require("../models/Citation.model");

const DEFAULT_LOCATION = "Dirección";

async function main() {
  const isDryRun = process.env.DRY_RUN === "1";

  console.log("[backfill-citation-location] Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const filter = {
      $or: [
        { location: { $exists: false } },
        { location: null },
        { location: "" },
      ],
    };

    const total = await Citation.countDocuments(filter);
    if (total === 0) {
      console.log(
        "[backfill-citation-location] No citations missing `location`. Nothing to do."
      );
      return;
    }

    console.log(
      `[backfill-citation-location] Found ${total} citation(s) without location.`
    );

    if (isDryRun) {
      const sample = await Citation.findOne(filter)
        .select("_id student scheduledDate")
        .lean();
      console.log(
        `[backfill-citation-location] DRY_RUN: would set location="${DEFAULT_LOCATION}" on ${total} doc(s).`
      );
      console.log("[backfill-citation-location] Sample:", sample);
      return;
    }

    const result = await Citation.updateMany(filter, {
      $set: { location: DEFAULT_LOCATION },
    });

    console.log("[backfill-citation-location] DONE.");
    console.log(`  matched:  ${result.matchedCount}`);
    console.log(`  modified: ${result.modifiedCount}`);
  } catch (error) {
    console.error("[backfill-citation-location] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[backfill-citation-location] Disconnected");
  }
}

main();