// Migración one-shot: modela los talleres de Tecnología como grupos
// transversales (`Group.type: "taller"`).
//
// Antes: cada grupo de origen (1A-3D) tenía 4 TeacherSubject + 4 ClassSchedule
// de Tecnología (los 4 maestros de taller en el mismo bloque) → implicaba que
// cada alumno asiste a los 4 talleres a la vez.
//
// Después:
//   1. Se crean 12 grupos taller (4 talleres × 3 grados), mezclan alumnos de
//      varios grupos de origen del mismo grado.
//   2. Cada maestro de taller tiene Tecnología contra SUS grupos taller (3, uno
//      por grado), no contra los 12 grupos de origen.
//   3. El horario de Tecnología vive en los grupos taller (mismos bloques del
//      grado, que ya son correctos e iguales entre talleres).
//   4. Los grupos de origen se marcan `type: "regular"` y quedan SIN
//      Tecnología en su horario (el grupo se dispersa en ese bloque).
//   5. Student.workshop_group_id apunta al grupo taller de cada alumno
//      (distribución uniforme placeholder).
//
// Idempotente: si ya existen grupos taller para esta escuela/ciclo, aborta.
require("dotenv").config();
const mongoose = require("mongoose");
const Group = require("../models/Group.model");
const Subject = require("../models/Subject.model");
const User = require("../models/User.model");
const TeacherSubject = require("../models/TeacherSubject.model");
const ClassSchedule = require("../models/ClassSchedule.model");
const Student = require("../models/Student.model");
const SchoolShift = require("../models/SchoolShift.model");

const SCHOOL_ID = "6a790cb141b48704e7d2d72e";
const SCHOOL_YEAR_ID = "6a790cb141b48704e7d2d735";
const SHIFT_ID = "6a790cd53e4cc3b9db29b253";
const TEC_SUBJECT_ID = "6a7a2717eef3acfe47328982";

// Taller → maestro (id del User)
const TALLERES = [
  { name: "ELECTRÓNICA", teacherId: "6a7a22a8eef3acfe473288f0" }, // Jose Alberto Trejo Garcia
  { name: "ESTRUCTURAS METÁLICAS", teacherId: "6a7a22a8eef3acfe47328910" }, // Francisco Gustavo Godinez
  { name: "INFORMÁTICA", teacherId: "6a7a22a8eef3acfe47328959" }, // José Luis Téllez Bazán
  { name: "OFIMÁTICA", teacherId: "6a7a22a8eef3acfe473288ff" }, // Aldo Omar González Juárez
];

// Bloques horarios de Tecnología por grado (idénticos entre talleres del mismo grado).
// Se copian tal cual de los ClassSchedule de origen existentes (verificado contra la DB).
const BLOCKS = {
  1: { 1: "6a790d8356ebe005b96078e8:6a790d8356ebe005b96078e9", 2: "6a790d8356ebe005b96078ea:6a790d8356ebe005b96078eb", 3: "6a790d8356ebe005b96078e8:6a790d8356ebe005b96078e9", 4: "6a790d8356ebe005b96078e8:6a790d8356ebe005b96078e9" },
  2: { 1: "6a790d8356ebe005b96078ef:6a790d8356ebe005b96078f0", 2: "6a790d8356ebe005b96078ef:6a790d8356ebe005b96078f0", 3: "6a790d8356ebe005b96078ef:6a790d8356ebe005b96078f0", 4: "6a790d8356ebe005b96078ef:6a790d8356ebe005b96078f0" },
  3: { 1: "6a790d8356ebe005b96078ea:6a790d8356ebe005b96078eb", 2: "6a790d8356ebe005b96078e8:6a790d8356ebe005b96078e9", 3: "6a790d8356ebe005b96078ea:6a790d8356ebe005b96078eb", 4: "6a790d8356ebe005b96078ea:6a790d8356ebe005b96078eb" },
};

async function run() {
  await mongoose.connect(process.env.MONGO_URI);

  const shift = await SchoolShift.findById(SHIFT_ID).lean();
  if (!shift) throw new Error("SchoolShift not found");

  const existing = await Group.countDocuments({
    school: SCHOOL_ID,
    school_year_id: SCHOOL_YEAR_ID,
    type: "taller",
  });
  if (existing > 0) {
    console.log(`Ya existen ${existing} grupos taller — abortando (idempotente).`);
    await mongoose.disconnect();
    return;
  }

  const tecSubject = await Subject.findById(TEC_SUBJECT_ID).lean();
  if (!tecSubject) throw new Error("Subject TEC not found");

  // 1) Marcar grupos de origen como "regular" (quedaron sin el campo)
  const regUpdate = await Group.updateMany(
    { school: SCHOOL_ID, school_year_id: SCHOOL_YEAR_ID },
    { $set: { type: "regular" } }
  );
  console.log(`Grupos regular marcados: ${regUpdate.modifiedCount}`);

  // 2) Crear los 12 grupos taller
  const talleresByGrade = {}; // grade -> { tallerName: groupId }
  for (let grade = 1; grade <= 3; grade++) {
    talleresByGrade[grade] = {};
    for (const t of TALLERES) {
      const g = await Group.create({
        school: SCHOOL_ID,
        school_year_id: SCHOOL_YEAR_ID,
        grade,
        section: t.name,
        type: "taller",
        shift: "matutino",
        head_teacher_id: new mongoose.Types.ObjectId(t.teacherId),
      });
      talleresByGrade[grade][t.name] = g._id;
      console.log(`Grupo taller creado: ${grade}° ${t.name} -> ${g._id}`);
    }
  }

  // 3) Reasignar TeacherSubject de Tecnología: borrar los 48 sobre grupos de
  //    origen, crear 12 sobre grupos taller (cada maestro → sus 3 talleres).
  const delTS = await TeacherSubject.deleteMany({
    school: SCHOOL_ID,
    school_year_id: SCHOOL_YEAR_ID,
    subject_id: tecSubject._id,
  });
  console.log(`TeacherSubject TEC borrados: ${delTS.deletedCount}`);

  let tsCreated = 0;
  for (const t of TALLERES) {
    for (let grade = 1; grade <= 3; grade++) {
      await TeacherSubject.create({
        school: SCHOOL_ID,
        school_year_id: SCHOOL_YEAR_ID,
        teacher_id: new mongoose.Types.ObjectId(t.teacherId),
        subject_id: tecSubject._id,
        group_id: talleresByGrade[grade][t.name],
      });
      tsCreated++;
    }
  }
  console.log(`TeacherSubject TEC creados: ${tsCreated}`);

  // 4) Reasignar ClassSchedule de Tecnología: borrar los 48 de grupos de
  //    origen, crear 12 (uno por grupo taller) con los bloques del grado.
  const delCS = await ClassSchedule.deleteMany({
    school: SCHOOL_ID,
    school_year_id: SCHOOL_YEAR_ID,
    subject_id: tecSubject._id,
  });
  console.log(`ClassSchedule TEC borrados: ${delCS.deletedCount}`);

  let csCreated = 0;
  for (let grade = 1; grade <= 3; grade++) {
    for (const t of TALLERES) {
      const slots = Object.entries(BLOCKS[grade]).map(([day, refs]) => ({
        dayOfWeek: Number(day),
        timeBlockRefs: refs.split(":"),
      }));
      await ClassSchedule.create({
        school: SCHOOL_ID,
        school_year_id: SCHOOL_YEAR_ID,
        group_id: talleresByGrade[grade][t.name],
        subject_id: tecSubject._id,
        teacher_id: new mongoose.Types.ObjectId(t.teacherId),
        school_shift_id: shift._id,
        scheduleSlots: slots,
      });
      csCreated++;
    }
  }
  console.log(`ClassSchedule TEC creados: ${csCreated}`);

  // 5) Asignar alumnos a talleres (distribución uniforme placeholder).
  //    Por grado: round-robin sobre los alumnos de los 4 grupos de origen.
  const studentCount = await Student.countDocuments({ school: SCHOOL_ID });
  const totalTalleres = Object.values(TALLERES).length;
  const assigned = {};
  for (let grade = 1; grade <= 3; grade++) {
    const originGroups = await Group.find({
      school: SCHOOL_ID,
      school_year_id: SCHOOL_YEAR_ID,
      grade,
      type: "regular",
    }).select("_id");
    const students = await Student.find({
      school: SCHOOL_ID,
      current_group_id: { $in: originGroups.map((g) => g._id) },
    }).select("_id").sort({ controlNumber: 1 });
    let i = 0;
    for (const s of students) {
      const taller = TALLERES[i % totalTalleres];
      assigned[String(s._id)] = String(talleresByGrade[grade][taller.name]);
      i++;
    }
  }
  const ops = Object.entries(assigned).map(([sid, gid]) => ({
    updateOne: {
      filter: { _id: sid, school: SCHOOL_ID },
      update: { $set: { workshop_group_id: gid } },
    },
  }));
  const studRes = await Student.bulkWrite(ops, { ordered: false });
  console.log(`Alumnos asignados a taller: ${studRes.modifiedCount} de ${studentCount}`);

  await mongoose.disconnect();
  console.log("Migración completada.");
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
