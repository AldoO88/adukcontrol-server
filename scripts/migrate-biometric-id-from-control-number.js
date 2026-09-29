// scripts/migrate-biometric-id-from-control-number.js
// ---------------------------------------------------------------------
// Backfill idempotente: para cada Student con biometricId = null/undefined,
// copia su controlNumber al campo biometricId.
//
// Contexto: las terminales Hikvision DS-K1T323 y, eventualmente, también
// las ZKTeco necesitan un "Employee ID" / PIN con el que se identifica al
// alumno. La convención adoptada es usar el controlNumber (10 dígitos,
// numérico, único por escuela) — es estable, auto-generado y human-readable.
//
// Esta migración se corre UNA sola vez después del deploy que introduce el
// auto-asignado en el pre-save de Student (models/Student.model.js).
// A partir de ahí, todos los Student nuevos nacen con biometricId =
// controlNumber automáticamente; los existentes ya los completa este script.
//
// Flags:
//   --dry-run   Cuenta lo que haría y no escribe nada.
//   --force     Sobrescribe TODOS los biometricId (incluso los manuales).
//               Útil si sabés que los manuales están desactualizados (p.ej.
//               cambio de terminales). Por defecto solo completa los null.
//
// Uso:
//   node scripts/migrate-biometric-id-from-control-number.js
//   node scripts/migrate-biometric-id-from-control-number.js --dry-run
//   node scripts/migrate-biometric-id-from-control-number.js --force

require("dotenv").config();

const mongoose = require("mongoose");
const Student = require("../models/Student.model");

const parseArgs = () => {
  const out = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i];
    if (k && k.startsWith("--")) {
      out[k.slice(2)] = true;
    }
  }
  return out;
};

const safeMongoHost = (uri) => {
  try {
    const u = new URL(uri);
    return `${u.protocol}//${u.username ? "***@" : ""}${u.hostname}${u.pathname}`;
  } catch {
    return "(uri no parseable)";
  }
};

async function main() {
  const args = parseArgs();
  const dryRun = !!args["dry-run"];
  const force = !!args["force"];

  console.log(
    `[migrate-biometric-id] dry-run=${dryRun} force=${force}`
  );
  console.log(
    `[migrate-biometric-id] MONGO_URI host: ${safeMongoHost(process.env.MONGO_URI)}`
  );

  if (!process.env.MONGO_URI) {
    console.error(
      "[!] MONGO_URI no está definido. Cargá .env o exportá la variable antes de correr el script."
    );
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const total = await Student.countDocuments({});
    const withControlNumber = await Student.countDocuments({
      controlNumber: { $type: "string" },
    });
    const withNullBiometricId = await Student.countDocuments({
      $or: [{ biometricId: null }, { biometricId: { $exists: false } }],
    });
    const withBiometricId = await Student.countDocuments({
      biometricId: { $type: "string" },
    });
    const mismatched = await Student.countDocuments({
      biometricId: { $type: "string" },
      controlNumber: { $type: "string" },
      $expr: { $ne: ["$biometricId", "$controlNumber"] },
    });

    console.log(`[migrate-biometric-id] Snapshot:`);
    console.log(`  total students:                ${total}`);
    console.log(`  with controlNumber:            ${withControlNumber}`);
    console.log(`  with biometricId (any value):  ${withBiometricId}`);
    console.log(`  with biometricId null:         ${withNullBiometricId}`);
    console.log(
      `  biometricId ≠ controlNumber:   ${mismatched} (won't touch unless --force)`
    );

    if (dryRun) {
      console.log(
        "[dry-run] OK. Re-ejecutá sin --dry-run para aplicar los cambios."
      );
      return;
    }

    // Confirmación explícita cuando se ejecuta en modo real.
    if (!force) {
      console.log(
        "\nEsta migración va a copiar `controlNumber` → `biometricId` para todos los"
      );
      console.log(
        "alumnos con `biometricId` nulo. Los alumnos con un `biometricId` manual"
      );
      console.log("(incluso si no coincide con `controlNumber`) NO se tocan.");
      console.log(
        "Para forzar la sobrescritura, pasá --force. Para abortar, Ctrl-C."
      );
      console.log("\n¿Continuar? (escribí `yes` para confirmar)");
      process.stdin.setEncoding("utf8");
      const answer = await new Promise((resolve) => {
        process.stdin.once("data", (data) => resolve(String(data).trim()));
        process.stdin.once("error", () => resolve(""));
      });
      if (answer !== "yes") {
        console.log("[abort] cancelado por el usuario");
        return;
      }
    }

    // 1) Backfill de null/undefined → controlNumber.
    //    Usamos updateMany con aggregation pipeline (Mongo 4.2+) para copiar
    //    el campo en una sola operación.
    const fillResult = await Student.updateMany(
      {
        controlNumber: { $type: "string" },
        $or: [
          { biometricId: null },
          { biometricId: { $exists: false } },
        ],
      },
      [
        {
          $set: {
            biometricId: "$controlNumber",
          },
        },
      ]
    );

    console.log(
      `\n[ok] Backfill completado: ${fillResult.modifiedCount} alumnos actualizados (matched=${fillResult.matchedCount}).`
    );

    // 2) Si --force, sobrescribir los manuales que no calzan.
    if (force) {
      const forceResult = await Student.updateMany(
        {
          controlNumber: { $type: "string" },
          biometricId: { $type: "string" },
          $expr: { $ne: ["$biometricId", "$controlNumber"] },
        },
        [
          {
            $set: { biometricId: "$controlNumber" },
          },
        ]
      );
      console.log(
        `[ok] --force aplicado: ${forceResult.modifiedCount} alumnos sobrescritos (matched=${forceResult.matchedCount}).`
      );
    }

    // Reporte final: ¿quedó alguno sin biometricId?
    const remainingNull = await Student.countDocuments({
      $or: [{ biometricId: null }, { biometricId: { $exists: false } }],
    });
    if (remainingNull > 0) {
      console.log(
        `\n[!] Quedan ${remainingNull} alumnos sin biometricId. Probablemente no tienen controlNumber todavía (¿sin escuela/grupo asignado?).`
      );
    } else {
      console.log("\n[ok] Todos los alumnos con controlNumber ahora tienen biometricId consistente.");
    }
  } catch (err) {
    console.error("[FAIL]", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[migrate-biometric-id] Disconnected");
  }
}

main();
