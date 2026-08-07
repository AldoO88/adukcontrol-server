// scripts/migrate-grade-periods.js
// Migra Grade.period (Number 0|1|2|3) → Grade.gradingPeriod (ref GradingPeriod)
// + Grade.period_order (copia desnormalizada del orden).
//
// Qué hace, en orden:
//   1. Por cada (school, school_year_id) que tenga calificaciones, crea los
//      GradingPeriod que falten a partir de los valores de `period` que
//      realmente existen en los datos. Las fechas se reparten en tramos
//      iguales sobre el rango del SchoolYear (son un PLACEHOLDER razonable:
//      la escuela debe corregirlas después desde el panel).
//   2. Reescribe cada Grade apuntando al GradingPeriod correspondiente.
//   3. Dropea el índice viejo `uniq_enrollment_subject_period`.
//
// Uso:
//   DRY_RUN=1 node scripts/migrate-grade-periods.js   # simula, no escribe
//   node scripts/migrate-grade-periods.js             # aplica
//
// IMPORTANTE: hacer BACKUP antes. Es idempotente: los Grade que ya tienen
// gradingPeriod se ignoran, y los GradingPeriod se crean con upsert.

require("dotenv").config();

const mongoose = require("mongoose");
const Grade = require("../models/Grade.model");
const GradingPeriod = require("../models/GradingPeriod.model");
const SchoolYear = require("../models/SchoolYear.model");

const DRY_RUN = process.env.DRY_RUN === "1";
const LOG = "[migrate-periods]";

// Nombres por defecto según el `period` viejo. 0 era la calificación final.
const DEFAULT_NAMES = {
  0: "Final",
  1: "Trimestre 1",
  2: "Trimestre 2",
  3: "Trimestre 3",
};

// Reparte el rango del ciclo en `total` tramos iguales y devuelve el tramo
// `index` (1-based). Placeholder: la escuela ajusta las fechas reales después.
const sliceDates = (schoolYear, index, total) => {
  const start = schoolYear && schoolYear.startDate ? new Date(schoolYear.startDate) : null;
  const end = schoolYear && schoolYear.endDate ? new Date(schoolYear.endDate) : null;

  if (!start || !end || total < 1) {
    // Sin fechas de ciclo no podemos inventar nada coherente: usamos el mismo
    // día para start y end y dejamos que la escuela lo corrija.
    const fallback = start || new Date();
    return { startDate: fallback, endDate: fallback };
  }

  const span = end.getTime() - start.getTime();
  const chunk = Math.floor(span / total);
  return {
    startDate: new Date(start.getTime() + chunk * (index - 1)),
    endDate: new Date(index === total ? end.getTime() : start.getTime() + chunk * index - 1),
  };
};

async function main() {
  console.log(`${LOG} Connecting to MongoDB...`);
  await mongoose.connect(process.env.MONGO_URI);

  if (DRY_RUN) console.log(`${LOG} DRY_RUN=1 — no se escribirá nada.`);

  try {
    // --- 1. Agrupar los períodos viejos que existen en los datos ---------
    const combos = await Grade.aggregate([
      { $match: { period: { $exists: true }, gradingPeriod: { $exists: false } } },
      {
        $group: {
          _id: { school: "$school", school_year_id: "$school_year_id" },
          periods: { $addToSet: "$period" },
          count: { $sum: 1 },
        },
      },
    ]);

    if (combos.length === 0) {
      console.log(`${LOG} No hay Grades con \`period\` sin migrar. Nada que hacer.`);
    }

    let periodsCreated = 0;
    let gradesUpdated = 0;

    for (const combo of combos) {
      const { school, school_year_id } = combo._id;
      const schoolYear = await SchoolYear.findById(school_year_id).lean();

      // Ordinarios (1..N) ordenados; el 0 (final) se trata aparte porque no
      // ocupa un tramo del calendario.
      const ordinals = combo.periods.filter((p) => p > 0).sort((a, b) => a - b);
      const hasFinal = combo.periods.includes(0);

      console.log(
        `${LOG} school=${school} year=${school_year_id}: ${combo.count} grades, periods=[${combo.periods.sort().join(",")}]`
      );

      const periodByOrder = new Map();

      for (let i = 0; i < ordinals.length; i += 1) {
        const order = ordinals[i];
        const { startDate, endDate } = sliceDates(schoolYear, i + 1, ordinals.length);
        const doc = {
          school,
          school_year_id,
          name: DEFAULT_NAMES[order] || `Período ${order}`,
          order,
          startDate,
          endDate,
        };

        if (DRY_RUN) {
          console.log(`${LOG}   would upsert GradingPeriod ${doc.name} (order ${order})`);
          periodByOrder.set(order, { _id: `dry-run-${order}` });
          continue;
        }

        // Upsert por (school, year, order) — la clave del índice único.
        const created = await GradingPeriod.findOneAndUpdate(
          { school, school_year_id, order },
          { $setOnInsert: doc },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        periodByOrder.set(order, created);
        periodsCreated += 1;
      }

      if (hasFinal) {
        const lastDate =
          schoolYear && schoolYear.endDate ? new Date(schoolYear.endDate) : new Date();
        const doc = {
          school,
          school_year_id,
          name: DEFAULT_NAMES[0],
          order: 0,
          startDate: lastDate,
          endDate: lastDate,
        };

        if (DRY_RUN) {
          console.log(`${LOG}   would upsert GradingPeriod ${doc.name} (order 0)`);
          periodByOrder.set(0, { _id: "dry-run-0" });
        } else {
          const created = await GradingPeriod.findOneAndUpdate(
            { school, school_year_id, order: 0 },
            { $setOnInsert: doc },
            { new: true, upsert: true, setDefaultsOnInsert: true }
          );
          periodByOrder.set(0, created);
          periodsCreated += 1;
        }
      }

      // --- 2. Reapuntar los Grades de este (school, year) ----------------
      for (const [order, periodDoc] of periodByOrder.entries()) {
        const filter = {
          school,
          school_year_id,
          period: order,
          gradingPeriod: { $exists: false },
        };

        if (DRY_RUN) {
          const n = await Grade.countDocuments(filter);
          console.log(`${LOG}   would update ${n} grades → order ${order}`);
          continue;
        }

        const res = await Grade.updateMany(filter, {
          $set: { gradingPeriod: periodDoc._id, period_order: order },
          $unset: { period: "" },
        });
        gradesUpdated += res.modifiedCount || 0;
      }
    }

    // --- 3. Dropear el índice viejo -------------------------------------
    // Mongoose crea los índices nuevos pero NUNCA borra los que ya no están
    // en el schema: si se queda, sigue exigiendo unicidad sobre un campo que
    // ya no existe y bloquea la segunda calificación de cada alumno.
    if (!DRY_RUN) {
      try {
        await Grade.collection.dropIndex("uniq_enrollment_subject_period");
        console.log(`${LOG} Índice viejo uniq_enrollment_subject_period eliminado.`);
      } catch (err) {
        if (err.codeName === "IndexNotFound" || err.code === 27) {
          console.log(`${LOG} El índice viejo ya no existía.`);
        } else {
          throw err;
        }
      }
      await Grade.syncIndexes();
      console.log(`${LOG} Índices de Grade sincronizados.`);
    }

    console.log(
      `${LOG} Listo. GradingPeriods upserted: ${periodsCreated}, Grades migrados: ${gradesUpdated}.`
    );
    if (!DRY_RUN && periodsCreated > 0) {
      console.log(
        `${LOG} OJO: las fechas de los períodos son un PLACEHOLDER repartido en tramos iguales. Corrígelas desde el panel de la escuela.`
      );
    }
  } finally {
    await mongoose.disconnect();
    console.log(`${LOG} Desconectado.`);
  }
}

main().catch((err) => {
  console.error(`${LOG} FALLÓ:`, err);
  process.exit(1);
});
