// scripts/backfill-guardian-active.js
// ---------------------------------------------------------------------
// Backfill idempotente: pone isActive=true a todos los Guardian que no
// lo tengan seteado (campo ausente) o que estén en false.
//
// Contexto: con el cambio de semántica (Guardian.model.isActive.default = true)
// todos los guardian nuevos nacen activos. Los 422 guardian existentes
// nunca pudieron ser "baja" (no había UI), por lo que todos los
// `isActive` ausentes o `false` actuales son CUENTAS VIGENTES — NO
// tutores dados de baja. Es seguro flipear a `true`.
//
// Flags:
//   DRY_RUN=1   Cuenta lo que haría y no escribe nada (default: ON).
//               Para aplicar: DRY_RUN=0 node scripts/backfill-guardian-active.js
//
// Uso:
//   DRY_RUN=1 node scripts/backfill-guardian-active.js
//   DRY_RUN=0 node scripts/backfill-guardian-active.js
//
// El script respeta el MONGO_URI del entorno (igual que
// scripts/backfill-user-active.js) para apuntar a staging o producción.

require("dotenv").config();

const mongoose = require("mongoose");
const Guardian = require("../models/Guardian.model");

const DRY_RUN = process.env.DRY_RUN !== "0" && process.env.DRY_RUN !== "false";

const main = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("ERROR: MONGO_URI no está definido en el entorno.");
    process.exit(1);
  }

  await mongoose.connect(uri);

  try {
    // Docs sin el campo (null/missing) + docs con isActive=false.
    const noField = await Guardian.countDocuments({ isActive: { $exists: false } });
    const falseCount = await Guardian.countDocuments({ isActive: false });
    const totalCount = await Guardian.countDocuments({});

    console.log("=== Backfill Guardian.isActive=true ===");
    console.log(`DRY_RUN: ${DRY_RUN}`);
    console.log(`Total guardians: ${totalCount}`);
    console.log(`Guardians sin isActive (campo ausente): ${noField}`);
    console.log(`Guardians con isActive=false:           ${falseCount}`);
    console.log(`A actualizar a true:                   ${noField + falseCount}`);

    if (noField + falseCount === 0) {
      console.log("Nada que flipear. Saliendo.");
      return;
    }

    if (DRY_RUN) {
      console.log("");
      console.log("DRY RUN: no se modificó la DB. Para aplicar de verdad:");
      console.log("  DRY_RUN=0 node scripts/backfill-guardian-active.js");
      return;
    }

    const result = await Guardian.updateMany(
      { $or: [{ isActive: { $exists: false } }, { isActive: false }] },
      { $set: { isActive: true } }
    );
    console.log("");
    console.log(
      `Resultado: matched=${result.matchedCount}, modified=${result.modifiedCount}`
    );
    console.log("Backfill aplicado.");
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((err) => {
  console.error("Backfill falló:", err);
  process.exit(1);
});