// scripts/backfill-user-active.js
// ---------------------------------------------------------------------
// Backfill idempotente: pone isActive=true a TODOS los User que tengan
// isActive=false en la DB.
//
// Contexto: con el cambio de semántica (User.model.isActive.default = true),
// todos los users nuevos nacen activos. El guard de login pasa a bloquear
// isActive=false con código 403. Los usuarios existentes nunca pudieron ser
// "baja" (no había UI de Personal con la opción Inactivo), por lo que
// todos los isActive=false actuales son CUENTAS PENDIENTES DE ACTIVAR
// (staff sin password, tutores recién importados que no hicieron OTP, etc.)
// — NO cuentas dadas de baja. Es seguro flipear a true.
//
// IMPORTANTE: correr ANTES del deploy del guard de login; si se sube el
// código nuevo sin backfill, los admins creados con password pero isActive=false
// se quedarían bloqueados.
//
// Flags:
//   DRY_RUN=1   Cuenta lo que haría y no escribe nada (default: ON).
//               Para aplicar: DRY_RUN=0 node scripts/backfill-user-active.js
//
// Uso:
//   DRY_RUN=1 node scripts/backfill-user-active.js
//   DRY_RUN=0 node scripts/backfill-user-active.js
//
// El script respeta el MONGO_URI del entorno (igual que
// scripts/create-super-admin.js) para apuntar a staging o producción.

require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User.model");

const DRY_RUN = process.env.DRY_RUN !== "0" && process.env.DRY_RUN !== "false";

const main = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("ERROR: MONGO_URI no está definido en el entorno.");
    process.exit(1);
  }

  await mongoose.connect(uri);

  try {
    const inactiveCount = await User.countDocuments({ isActive: false });
    const totalCount = await User.countDocuments({});

    console.log("=== Backfill isActive=true ===");
    console.log(`DRY_RUN: ${DRY_RUN}`);
    console.log(`Total users: ${totalCount}`);
    console.log(`Users con isActive=false: ${inactiveCount}`);

    if (inactiveCount === 0) {
      console.log("Nada que flipear. Saliendo.");
      return;
    }

    if (DRY_RUN) {
      console.log("");
      console.log("DRY RUN: no se modificó la DB. Para aplicar de verdad:");
      console.log("  DRY_RUN=0 node scripts/backfill-user-active.js");
      return;
    }

    // Antes de all-up: agrupar por rol para que el operador vea qué se
    // está tocando (super_admin, tutor, teacher, …).
    const filasPorRol = await User.aggregate([
      { $match: { isActive: false } },
      { $group: { _id: "$role", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    console.log("");
    console.log("Distribución de isActive=false por rol (antes):");
    for (const fila of filasPorRol) {
      console.log(`  - ${fila._id}: ${fila.count}`);
    }

    const result = await User.updateMany(
      { isActive: false },
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