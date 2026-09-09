// scripts/set-subject-colors.js
// Asigna color (hex) e icon (lucide-react-native) a las materias existentes.
// DRY_RUN=1 para simular sin escribir. Idempotente.
require("dotenv").config();
const mongoose = require("mongoose");
const Subject = require("../models/Subject.model");

const SUBJECT_STYLES = {
  "Español":                          { color: "#3B82F6", icon: "BookOpen" },
  "Matemáticas":                      { color: "#8B5CF6", icon: "Calculator" },
  "Inglés":                           { color: "#06B6D4", icon: "Globe" },
  "Biología":                         { color: "#22C55E", icon: "Leaf" },
  "Química":                          { color: "#10B981", icon: "FlaskConical" },
  "Física":                           { color: "#A855F7", icon: "Atom" },
  "Geografía":                        { color: "#F59E0B", icon: "Map" },
  "Historia I":                       { color: "#EF4444", icon: "Landmark" },
  "Historia II":                      { color: "#DC2626", icon: "Landmark" },
  "Historia III":                     { color: "#B91C1C", icon: "Landmark" },
  "Educación Física":                 { color: "#F97316", icon: "Dumbbell" },
  "Artes":                            { color: "#EC4899", icon: "Palette" },
  "Formación Civica y Ética":        { color: "#6366F1", icon: "Scale" },
  "Integración Curricular":           { color: "#14B8A6", icon: "Puzzle" },
  "Tutoría":                          { color: "#64748B", icon: "Users" },
  "Tecnología":                       { color: "#0EA5E9", icon: "Cpu" },
};

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`[set-subject-colors] Mode: ${DRY_RUN ? "DRY RUN" : "WRITE"}\n`);

  const subjects = await Subject.find({ isActive: true }).select("name color icon").lean();
  console.log(`Found ${subjects.length} active subjects.\n`);

  let updated = 0;
  let skipped = 0;
  let unmapped = 0;

  for (const s of subjects) {
    const style = SUBJECT_STYLES[s.name];

    if (!style) {
      console.log(`  ⚠️  No mapping for "${s.name}" (id: ${s._id})`);
      unmapped++;
      continue;
    }

    if (s.color === style.color && s.icon === style.icon) {
      skipped++;
      continue;
    }

    console.log(`  → ${s.name}: color ${s.color || "null"} → ${style.color}, icon ${s.icon || "null"} → ${style.icon}`);

    if (!DRY_RUN) {
      await Subject.updateOne(
        { _id: s._id },
        { $set: { color: style.color, icon: style.icon } }
      );
    }
    updated++;
  }

  console.log(`\n[set-subject-colors] Summary:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (already set): ${skipped}`);
  console.log(`  Unmapped: ${unmapped}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("[set-subject-colors] Error:", err);
  process.exit(1);
});
