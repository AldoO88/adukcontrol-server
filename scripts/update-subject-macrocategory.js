// scripts/update-subject-macrocategory.js
// Actualiza el campo `macroCategory` de Subject según las categorías
// formativas de la escuela secundaria técnica.
//
// Categorías:
//   - Lenguajes: Español, Inglés, Artes
//   - Saberes y pensamiento científico: Matemáticas, Biología, Física, Química
//   - Ética Naturaleza y sociedades: Geografía, Historia, Formación Cívica y ética
//   - De lo Humano a lo Comunitario: Tecnología, Tutoría, Educación Socioemocional, Educación Física
//
// Uso:
//   node scripts/update-subject-macrocategory.js             # ejecuta
//   DRY_RUN=1 node scripts/update-subject-macrocategory.js  # solo loguea
//
// IMPORTANTE: hacer backup antes.

require("dotenv").config();

const mongoose = require("mongoose");
const Subject = require("../models/Subject.model");

// Mapa: macroCategory -> [nombres de materias (parcial, case-insensitive)]
// Orden importa: keywords más específicas primero para evitar falsos positivos
const CATEGORY_MAP = {
  "De lo Humano a lo Comunitario": ["educación física", "educacion fisica", "educación socioemocional", "educacion socioemocional", "tutoría", "tutoria", "tecnología", "tecnologia"],
  "Ética Naturaleza y sociedades": ["formación cívica y ética", "formacion civica y etica", "geografía", "geografia", "historia"],
  "Saberes y pensamiento científico": ["química", "quimica", "física", "fisica", "biología", "biologia", "matemáticas", "matematicas"],
  "Lenguajes": ["español", "espanol", "inglés", "ingles", "artes"],
};

// Normalizar texto para comparación (quitar acentos, lowercase)
function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Buscar categoría de un nombre de materia
function findCategory(subjectName) {
  const normalized = normalize(subjectName);
  for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
    for (const keyword of keywords) {
      if (normalized.includes(normalize(keyword))) {
        return category;
      }
    }
  }
  return null;
}

async function main() {
  const isDryRun = process.env.DRY_RUN === "1";
  console.log(`[update-subject-macrocategory] ${isDryRun ? "DRY RUN" : "LIVE MODE"}`);
  console.log("[update-subject-macrocategory] Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const subjects = await Subject.find({}).select("name macroCategory school").lean();
    console.log(`[update-subject-macrocategory] Found ${subjects.length} subjects total.`);

    let updated = 0;
    let skipped = 0;
    let notFound = 0;

    for (const subject of subjects) {
      const category = findCategory(subject.name);

      if (!category) {
        console.log(`  ⏭  "${subject.name}" → no category match (skipped)`);
        notFound++;
        continue;
      }

      if (subject.macroCategory === category) {
        skipped++;
        continue;
      }

      if (isDryRun) {
        console.log(`  🔍 "${subject.name}" → would set macroCategory = "${category}"`);
        updated++;
      } else {
        await Subject.updateOne(
          { _id: subject._id },
          { $set: { macroCategory: category } }
        );
        console.log(`  ✅ "${subject.name}" → macroCategory = "${category}"`);
        updated++;
      }
    }

    console.log(`\n[update-subject-macrocategory] Done.`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Already set (skipped): ${skipped}`);
    console.log(`  No category match: ${notFound}`);
  } catch (error) {
    console.error("[update-subject-macrocategory] Error:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("[update-subject-macrocategory] MongoDB disconnected.");
  }
}

main();
