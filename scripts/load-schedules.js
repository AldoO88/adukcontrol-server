// Carga horarios maestro por maestro. Modo DRY_RUN (default): solo valida y detecta conflictos.
// Para escribir: DRY_RUN=0 node scripts/load-schedules.js
require("dotenv").config();
const mongoose = require("mongoose");
const SchoolShift = require("../models/SchoolShift.model");
const Group = require("../models/Group.model");
const Subject = require("../models/Subject.model");
const User = require("../models/User.model");
const TeacherSubject = require("../models/TeacherSubject.model");
const ClassSchedule = require("../models/ClassSchedule.model");

const SCHOOL_ID = "6a790cb141b48704e7d2d72e";
const SCHOOL_YEAR_ID = "6a790cb141b48704e7d2d735";
const SHIFT_ID = "6a790cd53e4cc3b9db29b253";

const DAYS = { 1: "LUN", 2: "MAR", 3: "MIE", 4: "JUE", 5: "VIE" };

// taller section per teacher
const TALLER_SECTION = {
  "Jose Alberto Trejo Garcia": "ELECTRÓNICA",
  "Francisco Gustavo Godinez": "ESTRUCTURAS METÁLICAS",
  "José Luis Téllez Bazán": "INFORMÁTICA",
  "Aldo Omar González Juárez": "OFIMÁTICA",
};

// Cada entrada: [day, "M1-M3" o "M2", subjectCode, target]
//   - target "1A".."3D" para grupos de origen
//   - target "TALLER:<grado>" para el taller de ese maestro
const SCHEDULES = [
  ["Jonathan Dominguez Ramirez", [
    [1, "M6", "ESP", "3C"],
    [2, "M3", "ESP", "3A"], [2, "M5-M6", "ESP", "3B"], [2, "M7", "ESP", "3D"],
    [3, "M5-M6", "ESP", "3D"],
    [4, "M1", "ESP", "3B"], [4, "M5-M6", "ESP", "3A"], [4, "M7-M8", "ESP", "3C"],
    [5, "M1-M2", "ESP", "3B"], [5, "M3-M4", "ESP", "3A"], [5, "M5-M6", "ESP", "3C"], [5, "M7-M8", "ESP", "3D"],
  ]],
  ["Elizabeth Sánchez Ramírez", [
    [1, "M1-M2", "ESP", "2C"], [1, "M3-M4", "ESP", "2A"], [1, "M5", "ESP", "1C"], [1, "M6", "ESP", "2B"], [1, "M7", "ESP", "1A"], [1, "M8", "ESP", "1B"],
    [2, "M1-M2", "ESP", "1D"], [2, "M3-M4", "ESP", "2D"], [2, "M5-M6", "ESP", "2C"], [2, "M7-M8", "ESP", "1B"],
    [3, "M1-M2", "ESP", "2A"], [3, "M3-M4", "ESP", "1D"], [3, "M5-M6", "ESP", "2D"], [3, "M7-M8", "ESP", "1C"],
    [4, "M1", "ESP", "2D"], [4, "M2-M3", "ESP", "2B"], [4, "M4", "ESP", "2C"], [4, "M5", "ESP", "1D"], [4, "M6", "ESP", "2A"], [4, "M7-M8", "ESP", "1A"],
    [5, "M1-M2", "ESP", "1C"], [5, "M3-M4", "ESP", "1A"], [5, "M5-M6", "ESP", "2B"], [5, "M7-M8", "ESP", "1B"],
  ]],
  ["Armando Efrain Moguel Vite", [
    [1, "M1-M2", "MAT", "2B"], [1, "M3-M4", "MAT", "2D"], [1, "M5-M6", "MAT", "1A"], [1, "M7-M8", "MAT", "1D"],
    [2, "M1", "MAT", "2D"], [2, "M2", "MAT", "2C"], [2, "M3-M4", "MAT", "2A"], [2, "M5-M6", "MAT", "1B"], [2, "M7-M8", "MAT", "1C"],
    [3, "M1-M2", "MAT", "2B"], [3, "M3-M4", "MAT", "1C"], [3, "M5-M6", "MAT", "2C"], [3, "M7-M8", "MAT", "1A"],
    [4, "M1-M2", "MAT", "2A"], [4, "M3", "MAT", "1D"], [4, "M4", "MAT", "2B"], [4, "M5-M6", "MAT", "2C"], [4, "M7-M8", "MAT", "1B"],
    [5, "M1", "MAT", "1A"], [5, "M2", "MAT", "1B"], [5, "M3", "MAT", "2A"], [5, "M4", "MAT", "1C"], [5, "M5-M6", "MAT", "2D"], [5, "M7-M8", "MAT", "1D"],
  ]],
  ["Leidy Mariana Téllez Rangel", [
    [1, "M1-M2", "HIST_III", "3D"], [1, "M4", "TUT", "1B"], [1, "M5-M6", "HIST_II", "2C"], [1, "M7-M8", "HIST_III", "3B"],
    [2, "M1-M2", "FCYE", "1C"], [2, "M3-M4", "HIST_III", "3C"], [2, "M5-M6", "HIST_II", "2B"], [2, "M7-M8", "HIST_III", "3A"],
    [3, "M1-M2", "HIST_III", "3A"], [3, "M3-M4", "HIST_II", "2D"], [3, "M5-M6", "HIST_II", "2B"], [3, "M7-M8", "HIST_III", "3B"],
    [4, "M1-M2", "HIST_III", "3C"], [4, "M3-M4", "HIST_II", "2A"], [4, "M5-M6", "HIST_II", "2D"],
    [5, "M1-M2", "HIST_III", "3D"], [5, "M3-M4", "FCYE", "1B"], [5, "M5-M6", "HIST_II", "2A"], [5, "M7-M8", "HIST_II", "2C"],
  ]],
  ["Heriberto Romero Bartolo", [
    [1, "M1-M2", "FCYE", "3B"], [1, "M3-M4", "GEO", "1C"], [1, "M5-M6", "FCYE", "2A"], [1, "M7-M8", "FCYE", "3A"],
    [2, "M1-M2", "FCYE", "2B"], [2, "M3-M4", "FCYE", "2C"], [2, "M5", "TUT", "1A"], [2, "M7-M8", "GEO", "1D"],
    [3, "M1-M2", "FCYE", "3C"], [3, "M3-M4", "GEO", "1A"], [3, "M5-M6", "GEO", "1B"], [3, "M7-M8", "FCYE", "3D"],
    [4, "M3-M4", "GEO", "1B"], [4, "M5-M6", "GEO", "1A"], [4, "M7-M8", "GEO", "1D"],
    [5, "M1-M2", "FCYE", "2D"], [5, "M3-M4", "FCYE", "1D"], [5, "M5-M6", "FCYE", "1A"], [5, "M7-M8", "GEO", "1C"],
  ]],
  ["Jose Alberto Trejo Garcia", [
    [1, "M1-M2", "TEC", "TALLER:1"], [1, "M3-M4", "TEC", "TALLER:3"], [1, "M5", "MAT", "3C"], [1, "M7-M8", "TEC", "TALLER:2"],
    [2, "M1-M2", "TEC", "TALLER:3"], [2, "M3-M4", "TEC", "TALLER:1"], [2, "M7-M8", "TEC", "TALLER:2"],
    [3, "M1-M2", "TEC", "TALLER:1"], [3, "M3-M4", "TEC", "TALLER:3"], [3, "M5-M6", "MAT", "3C"], [3, "M7-M8", "TEC", "TALLER:2"],
    [4, "M1-M2", "TEC", "TALLER:1"], [4, "M3-M4", "TEC", "TALLER:3"], [4, "M6", "TUT", "3C"], [4, "M7-M8", "TEC", "TALLER:2"],
    [5, "M7-M8", "MAT", "3C"],
  ]],
  ["Obed Bautista Islas", [
    [1, "M5", "ART-001", "3D"], [1, "M6", "ART-001", "3A"],
    [2, "M5-M6", "ART-001", "3C"],
    [3, "M5", "ART-001", "3B"],
    [4, "M5", "ART-001", "3C"], [4, "M6", "ART-001", "1D"],
    [5, "M1-M2", "ART-001", "1D"], [5, "M3-M4", "ART-001", "3D"], [5, "M5-M6", "ART-001", "3B"], [5, "M7-M8", "ART-001", "3A"],
  ]],
  ["Omar Pontaza Castelazo", [
    [1, "M3-M4", "ED_FIS", "1D"], [1, "M5-M6", "ED_FIS", "1B"], [1, "M7-M8", "ED_FIS", "3C"],
    [2, "M1-M2", "ED_FIS", "1A"], [2, "M5-M6", "ED_FIS", "2A"], [2, "M7-M8", "ED_FIS", "3B"],
    [4, "M3", "TUT", "2C"], [4, "M4", "TUT", "1D"], [4, "M5-M6", "ED_FIS", "1C"], [4, "M7-M8", "ED_FIS", "3D"],
    [5, "M1-M2", "ED_FIS", "2B"], [5, "M3-M4", "ED_FIS", "2C"], [5, "M5-M6", "ED_FIS", "3A"], [5, "M7-M8", "ED_FIS", "2D"],
  ]],
  ["Araceli Baca Gomez", [
    [1, "M5-M6", "QUI", "3B"], [1, "M7-M8", "QUI", "3D"],
    [2, "M5-M6", "QUI", "3D"], [2, "M7-M8", "QUI", "3C"],
    [3, "M5-M6", "QUI", "3A"], [3, "M7-M8", "QUI", "3C"],
    [4, "M1", "TUT", "3D"], [4, "M5-M6", "QUI", "3B"], [4, "M7-M8", "QUI", "3A"],
    [5, "M1-M2", "QUI", "3A"], [5, "M3-M4", "QUI", "3C"], [5, "M5-M6", "QUI", "3D"], [5, "M7-M8", "QUI", "3B"],
  ]],
  ["Georgina Mariscal Navarro", [
    [1, "M1-M2", "FIS", "2A"], [1, "M3", "IC", "1B"], [1, "M5", "IC", "2B"], [1, "M6", "IC", "1D"], [1, "M7", "IC", "1C"], [1, "M8", "IC", "1A"],
    [2, "M1-M2", "BIO", "1B"], [2, "M4", "IC", "3A"], [2, "M5-M6", "BIO", "1D"], [2, "M7-M8", "BIO", "1A"],
    [3, "M1", "IC", "2C"], [3, "M3-M4", "BIO", "1B"], [3, "M5-M6", "FIS", "2A"], [3, "M7-M8", "BIO", "1D"],
    [4, "M1", "TUT", "2B"], [4, "M2", "IC", "3D"], [4, "M3-M4", "BIO", "1A"], [4, "M5", "TUT", "2A"], [4, "M7-M8", "BIO", "1C"],
    [5, "M1", "IC", "2A"], [5, "M2", "IC", "3C"], [5, "M3", "IC", "2D"], [5, "M4", "IC", "3B"], [5, "M5-M6", "BIO", "1C"], [5, "M7-M8", "FIS", "2A"],
  ]],
  ["Francisco Gustavo Godinez", [
    [1, "M1-M2", "TEC", "TALLER:1"], [1, "M3-M4", "TEC", "TALLER:3"], [1, "M7-M8", "TEC", "TALLER:2"],
    [2, "M1-M2", "TEC", "TALLER:3"], [2, "M3-M4", "TEC", "TALLER:1"], [2, "M7-M8", "TEC", "TALLER:2"],
    [3, "M1-M2", "TEC", "TALLER:1"], [3, "M3-M4", "TEC", "TALLER:3"], [3, "M7-M8", "TEC", "TALLER:2"],
    [4, "M1-M2", "TEC", "TALLER:1"], [4, "M3-M4", "TEC", "TALLER:3"], [4, "M7-M8", "TEC", "TALLER:2"],
  ]],
  ["José Luis Téllez Bazán", [
    [1, "M1-M2", "TEC", "TALLER:1"], [1, "M3-M4", "TEC", "TALLER:3"], [1, "M7-M8", "TEC", "TALLER:2"],
    [2, "M1-M2", "TEC", "TALLER:3"], [2, "M3-M4", "TEC", "TALLER:1"], [2, "M5-M6", "HIST_I", "1C"], [2, "M7-M8", "TEC", "TALLER:2"],
    [3, "M1-M2", "TEC", "TALLER:1"], [3, "M3-M4", "TEC", "TALLER:3"], [3, "M5-M6", "HIST_I", "1D"], [3, "M7-M8", "TEC", "TALLER:2"],
    [4, "M1-M2", "TEC", "TALLER:1"], [4, "M3-M4", "TEC", "TALLER:3"], [4, "M7-M8", "TEC", "TALLER:2"],
    [5, "M3", "TUT", "3B"], [5, "M5-M6", "HIST_I", "1B"], [5, "M7-M8", "HIST_I", "1A"],
  ]],
  ["Aldo Omar González Juárez", [
    [1, "M1-M2", "TEC", "TALLER:1"], [1, "M3-M4", "TEC", "TALLER:3"], [1, "M5", "TUT", "3A"], [1, "M6", "TUT", "1C"], [1, "M7-M8", "TEC", "TALLER:2"],
    [2, "M1-M2", "TEC", "TALLER:3"], [2, "M3-M4", "TEC", "TALLER:1"], [2, "M7-M8", "TEC", "TALLER:2"],
    [3, "M1-M2", "TEC", "TALLER:1"], [3, "M3-M4", "TEC", "TALLER:3"], [3, "M7-M8", "TEC", "TALLER:2"],
    [4, "M1-M2", "TEC", "TALLER:1"], [4, "M3-M4", "TEC", "TALLER:3"], [4, "M7-M8", "TEC", "TALLER:2"],
  ]],
  ["Sergio Melo Fabela", [
    [1, "M1-M2", "FIS", "2D"], [1, "M3-M4", "FIS", "2B"],
    [2, "M2", "TUT", "2D"], [2, "M3-M4", "FIS", "2B"],
    [3, "M1-M2", "FIS", "2D"], [3, "M3-M4", "FIS", "2C"],
    [4, "M1-M2", "FIS", "2C"], [4, "M3-M4", "FIS", "2D"],
    [5, "M1-M2", "FIS", "2C"], [5, "M3-M4", "FIS", "2B"],
  ]],
  ["Juan Francisco Aguilar Luna", [
    [1, "M1-M2", "ING", "3A"],
    [3, "M1-M2", "ING", "3B"],
    [4, "M1", "ING", "3A"], [4, "M2", "ING", "3B"],
  ]],
  ["Angelica Lopez Valencia", [
    [1, "M1-M2", "ING", "3C"], [1, "M3-M4", "ING", "2C"], [1, "M5", "ING", "1D"], [1, "M6", "ING", "3D"], [1, "M7", "ING", "1B"],
    [2, "M1-M2", "ING", "2A"], [2, "M3-M4", "ING", "3D"], [2, "M5-M6", "ING", "2D"],
    [3, "M2", "ING", "2C"], [3, "M3-M4", "ING", "2B"], [3, "M5-M6", "ING", "1A"],
    [4, "M2", "ING", "2D"], [4, "M3-M4", "ING", "1C"], [4, "M5-M6", "ING", "1B"],
    [5, "M1", "ING", "3C"], [5, "M2", "ING", "1A"], [5, "M3", "ING", "1C"], [5, "M4", "ING", "2A"], [5, "M5-M6", "ING", "1D"], [5, "M7", "ING", "2B"],
  ]],
  ["Salma Rebeca Cruz Hernandez", [
    [1, "M3-M4", "ART-001", "1A"], [1, "M5-M6", "ART-001", "2D"], [1, "M8", "ART-001", "1C"],
    [2, "M1", "ART-001", "2C"], [2, "M6", "ART-001", "1A"],
    [3, "M3-M4", "ART-001", "2A"], [3, "M5-M6", "ART-001", "1C"], [3, "M7-M8", "ART-001", "1B"],
    [4, "M5-M6", "ART-001", "2B"],
    [5, "M1", "ART-001", "1B"], [5, "M2", "ART-001", "2A"], [5, "M4", "ART-001", "2D"], [5, "M5-M6", "ART-001", "2C"], [5, "M8", "ART-001", "2B"],
  ]],
  ["Elibeth Moctezuma Hernandez", [
    [2, "M3-M4", "MAT", "3B"], [2, "M5-M6", "MAT", "3A"], [2, "M8", "MAT", "3D"],
    [3, "M1-M2", "MAT", "3D"], [3, "M6", "MAT", "3B"], [3, "M7-M8", "MAT", "3A"],
    [4, "M2", "MAT", "3A"], [4, "M5-M6", "MAT", "3D"], [4, "M7-M8", "MAT", "3B"],
  ]],
];

function parseBlocks(range) {
  if (!range.includes("-")) return [range];
  const [a, b] = range.split("-").map((x) => parseInt(x.replace("M", ""), 10));
  const out = [];
  for (let i = a; i <= b; i++) out.push(`M${i}`);
  return out;
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const shift = await SchoolShift.findById(SHIFT_ID).lean();
  const blockIdByName = {};
  for (const b of shift.timeBlocks) {
    blockIdByName[b.name] = String(b._id);
    const m = /Módulo (\d+)/.exec(b.name);
    if (m) blockIdByName[`M${m[1]}`] = String(b._id);
  }

  const groups = await Group.find({ school: SCHOOL_ID, school_year_id: SCHOOL_YEAR_ID }).lean();
  const originByKey = {};
  const tallerByGradeSection = {};
  for (const g of groups) {
    if (g.type === "taller") {
      if (!tallerByGradeSection[g.grade]) tallerByGradeSection[g.grade] = {};
      tallerByGradeSection[g.grade][g.section] = String(g._id);
    } else {
      originByKey[`${g.grade}${g.section}`] = String(g._id);
    }
  }

  const subjects = await Subject.find({ school: SCHOOL_ID }).lean();
  const subjectByCode = {};
  for (const s of subjects) subjectByCode[s.code] = String(s._id);

  const users = await User.find({ school: SCHOOL_ID }).lean();
  const teacherById = {};
  for (const u of users) teacherById[`${u.name} ${u.last_name}`] = String(u._id);

  const missingTeacher = SCHEDULES.filter(([name]) => !teacherById[name]);
  if (missingTeacher.length) {
    console.log("MAESTROS NO ENCONTRADOS:", missingTeacher.map(([n]) => n).join(", "));
    await mongoose.disconnect();
    return;
  }

  const resolved = [];
  const errors = [];
  for (const [teacherName, entries] of SCHEDULES) {
    const teacherId = teacherById[teacherName];
    const tallerSection = TALLER_SECTION[teacherName];
    for (const [day, range, code, target] of entries) {
      const blockNames = parseBlocks(range);
      const blockIds = blockNames.map((n) => blockIdByName[n]);
      if (blockIds.some((id) => !id)) {
        errors.push(`${teacherName}: bloque desconocido ${range} (${blockNames.join(",")})`);
        continue;
      }
      let groupId;
      if (target.startsWith("TALLER:")) {
        const grade = target.split(":")[1];
        groupId = tallerByGradeSection[grade] && tallerByGradeSection[grade][tallerSection];
        if (!groupId) {
          errors.push(`${teacherName}: grupo taller ${grade}°${tallerSection} no encontrado`);
          continue;
        }
      } else {
        groupId = originByKey[target];
        if (!groupId) {
          errors.push(`${teacherName}: grupo ${target} no encontrado`);
          continue;
        }
      }
      const subjectId = subjectByCode[code];
      if (!subjectId) {
        errors.push(`${teacherName}: materia ${code} no encontrada`);
        continue;
      }
      resolved.push({ teacherName, teacherId, subjectId, subjectCode: code, groupId, groupKey: target, day, blocks: blockIds, blockNames });
    }
  }

  if (errors.length) {
    console.log("ERRORES DE RESOLUCIÓN:");
    for (const e of errors) console.log("  -", e);
    await mongoose.disconnect();
    return;
  }

  const teacherOcc = {};
  const groupOcc = {};
  const conflicts = [];

  for (const r of resolved) {
    for (const blk of r.blockNames) {
      if (!teacherOcc[r.teacherId]) teacherOcc[r.teacherId] = {};
      if (!teacherOcc[r.teacherId][r.day]) teacherOcc[r.teacherId][r.day] = {};
      const prevT = teacherOcc[r.teacherId][r.day][blk];
      if (prevT && prevT !== r.groupKey) {
        conflicts.push(`CONFLICTO maestro: ${r.teacherName} ${DAYS[r.day]} ${blk} ya tiene ${prevT}, intenta ${r.groupKey}`);
      }
      teacherOcc[r.teacherId][r.day][blk] = r.groupKey;

      if (!groupOcc[r.groupId]) groupOcc[r.groupId] = {};
      if (!groupOcc[r.groupId][r.day]) groupOcc[r.groupId][r.day] = {};
      const prevG = groupOcc[r.groupId][r.day][blk];
      if (prevG && prevG.subjectCode !== r.subjectCode) {
        conflicts.push(`CONFLICTO grupo: ${r.groupKey} ${DAYS[r.day]} ${blk} ya tiene ${prevG.subjectCode} (${prevG.teacherName}), intenta ${r.subjectCode} (${r.teacherName})`);
      }
      groupOcc[r.groupId][r.day][blk] = { teacherName: r.teacherName, subjectCode: r.subjectCode };
    }
  }

  console.log(`Entradas resueltas: ${resolved.length}`);
  console.log(`Conflictos detectados: ${conflicts.length}`);
  for (const c of conflicts) console.log("  -", c);

  console.log("\n=== HORAS POR MAESTRO ===");
  const hoursByTeacher = {};
  for (const r of resolved) {
    if (!hoursByTeacher[r.teacherName]) hoursByTeacher[r.teacherName] = {};
    const key = `${r.groupKey}:${r.subjectCode}`;
    hoursByTeacher[r.teacherName][key] = (hoursByTeacher[r.teacherName][key] || 0) + r.blocks.length;
  }
  for (const [t, map] of Object.entries(hoursByTeacher)) {
    const total = Object.values(map).reduce((a, b) => a + b, 0);
    console.log(`  ${t}: ${total} hrs`);
  }

  const DRY_RUN = process.env.DRY_RUN !== "0";
  if (DRY_RUN || conflicts.length) {
    console.log(`\n${DRY_RUN ? "DRY_RUN: no se escribió nada." : "Hay conflictos: no se escribió nada."}`);
    await mongoose.disconnect();
    return;
  }

  await TeacherSubject.deleteMany({ school: SCHOOL_ID, school_year_id: SCHOOL_YEAR_ID });
  await ClassSchedule.deleteMany({ school: SCHOOL_ID, school_year_id: SCHOOL_YEAR_ID });

  const tsSet = new Set();
  const csMap = {};

  for (const r of resolved) {
    const tsKey = `${r.teacherId}|${r.subjectId}|${r.groupId}`;
    if (!tsSet.has(tsKey)) {
      tsSet.add(tsKey);
      await TeacherSubject.create({
        school: SCHOOL_ID, school_year_id: SCHOOL_YEAR_ID,
        teacher_id: r.teacherId, subject_id: r.subjectId, group_id: r.groupId,
      });
    }
    if (!csMap[tsKey]) csMap[tsKey] = { slots: {} };
    if (!csMap[tsKey].slots[r.day]) csMap[tsKey].slots[r.day] = new Set();
    for (const b of r.blocks) csMap[tsKey].slots[r.day].add(b);
  }

  let csCreated = 0;
  for (const [tsKey, data] of Object.entries(csMap)) {
    const [teacherId, subjectId, groupId] = tsKey.split("|");
    const slots = [];
    for (const [day, blockSet] of Object.entries(data.slots)) {
      const blockIds = [];
      for (let i = 1; i <= 8; i++) {
        const bid = blockIdByName[`M${i}`];
        if (blockSet.has(bid)) blockIds.push(bid);
      }
      slots.push({ dayOfWeek: Number(day), timeBlockRefs: blockIds });
    }
    await ClassSchedule.create({
      school: SCHOOL_ID, school_year_id: SCHOOL_YEAR_ID,
      group_id: groupId, subject_id: subjectId, teacher_id: teacherId,
      school_shift_id: shift._id, scheduleSlots: slots,
    });
    csCreated++;
  }

  console.log(`\nTeacherSubject creados: ${tsSet.size}`);
  console.log(`ClassSchedule creados: ${csCreated}`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
