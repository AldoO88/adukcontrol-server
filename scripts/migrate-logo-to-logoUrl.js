// scripts/migrate-logo-to-logoUrl.js
// Renombra el campo `logo` → `logoUrl` en los Schools existentes.
// Idempotente: si el campo `logo` ya no existe, no hace nada.
//
// Uso:
//   node scripts/migrate-logo-to-logoUrl.js
//
// IMPORTANTE: hacer backup antes.

require("dotenv").config();

const mongoose = require("mongoose");
const School = require("../models/School.model");

async function main() {
  console.log("[migrate-logo] Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    // Verificar si hay documentos con el campo viejo
    const sample = await School.findOne({ logo: { $exists: true } });
    if (!sample) {
      console.log(
        "[migrate-logo] No documents with `logo` field found. Nothing to migrate."
      );
      return;
    }

    // Renombrar el campo en todos los documentos
    const result = await School.collection.updateMany(
      { logo: { $exists: true } },
      { $rename: { logo: "logoUrl" } }
    );

    console.log("[migrate-logo] DONE.");
    console.log(`  matched:  ${result.matchedCount}`);
    console.log(`  modified: ${result.modifiedCount}`);
  } catch (error) {
    console.error("[migrate-logo] FAILED:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[migrate-logo] Disconnected");
  }
}

main();
