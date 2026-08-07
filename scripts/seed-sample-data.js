/**
 * Script para crear datos de ejemplo:
 * - 4 Materias (Matemáticas, Español, Ciencias, Historia)
 * - 3 Maestros (ya existe Juan, crea 2 más)
 * - 1 SchoolShift (Turno Matutino con 6 módulos)
 * - 3 GradingPeriods (T1, T2, T3)
 * - 4 TeacherSubjects (asignaciones)
 * - 4 ClassSchedule (horarios)
 * - 4 Grades (calificaciones de T1)
 *
 * USO: node scripts/seed-sample-data.js
 * Idempotente: no duplica si ya existen.
 */

require("dotenv").config();
const mongoose = require("mongoose");

const School = require("../models/School.model");
const User = require("../models/User.model");
const Group = require("../models/Group.model");
const Student = require("../models/Student.model");
const Enrollment = require("../models/Enrollment.model");
const Subject = require("../models/Subject.model");
const TeacherSubject = require("../models/TeacherSubject.model");
const ClassSchedule = require("../models/ClassSchedule.model");
const SchoolShift = require("../models/SchoolShift.model");
const GradingPeriod = require("../models/GradingPeriod.model");
const Grade = require("../models/Grade.model");

const SCHOOL_ID = "6a6ae79fffb4baa682fed408";
const YEAR_ID = "6a6ae885ffb4baa682fed40a";
const GROUP_ID = "6a6aeee96471c814a729d3a7";
const STUDENT_ID = "6a6aef806471c814a729d3a9";
const ENROLLMENT_ID = "6a6af00e6471c814a729d3ab";
const EXISTING_TEACHER_ID = "6a6aee3a6471c814a729d3a3"; // Juan García

const MATERIAS = [
  { code: "MAT", name: "Matemáticas", grade: 2 },
  { code: "ESP", name: "Español", grade: 2 },
  { code: "CIE", name: "Ciencias Naturales", grade: 2 },
  { code: "HIS", name: "Historia", grade: 2 },
];

const EXTRA_TEACHERS = [
  { name: "María", last_name: "García López", email: "maria.garcia@escuela47.edu.mx", phoneNumber: "1234567890" },
  { name: "Ana", last_name: "Martínez Ruiz", email: "ana.martinez@escuela47.edu.mx", phoneNumber: "0987654321" },
];

const PERIODS = [
  { name: "Trimestre 1", order: 1, startDate: "2025-08-18", endDate: "2025-11-21" },
  { name: "Trimestre 2", order: 2, startDate: "2025-11-24", endDate: "2026-03-13" },
  { name: "Trimestre 3", order: 3, startDate: "2026-03-16", endDate: "2026-07-10" },
];

// Horario: qué materia imparte quién en qué módulos
// dayOfWeek: 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie
const SCHEDULE = [
  // Matemáticas: Lun+Mié módulos 1-2, Vie módulo 1
  { subjectCode: "MAT", teacherIndex: 0, slots: [
    { dayOfWeek: 1, blocks: [0, 1] },
    { dayOfWeek: 3, blocks: [0, 1] },
    { dayOfWeek: 5, blocks: [0] },
  ]},
  // Español: Mar+Jue módulos 1-2, Vie módulo 2
  { subjectCode: "ESP", teacherIndex: 1, slots: [
    { dayOfWeek: 2, blocks: [0, 1] },
    { dayOfWeek: 4, blocks: [0, 1] },
    { dayOfWeek: 5, blocks: [1] },
  ]},
  // Ciencias: Lun+Mié módulos 3-4
  { subjectCode: "CIE", teacherIndex: 0, slots: [
    { dayOfWeek: 1, blocks: [3, 4] },
    { dayOfWeek: 3, blocks: [3, 4] },
  ]},
  // Historia: Mar+Jue módulos 3-4
  { subjectCode: "HIS", teacherIndex: 1, slots: [
    { dayOfWeek: 2, blocks: [3, 4] },
    { dayOfWeek: 4, blocks: [3, 4] },
  ]},
];

const GRADES_T1 = [
  { subjectCode: "MAT", value: 9.5 },
  { subjectCode: "ESP", value: 8.8 },
  { subjectCode: "CIE", value: 10 },
  { subjectCode: "HIS", value: 8.2 },
];

async function run() {
  console.log("Connecting to DB...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected.\n");

  // 1. CREAR MATERIAS
  console.log("📚 Creating subjects...");
  const subjectMap = new Map();
  for (const m of MATERIAS) {
    let subject = await Subject.findOne({ school: SCHOOL_ID, code: m.code });
    if (!subject) {
      subject = await Subject.create({ school: SCHOOL_ID, ...m });
      console.log(`   ✅ Created: ${m.name} (${m.code})`);
    } else {
      console.log(`   ⏭️  Exists: ${m.name} (${m.code})`);
    }
    subjectMap.set(m.code, subject);
  }

  // 2. CREAR MAESTROS EXTRA
  console.log("\n👨‍🏫 Creating teachers...");
  const teacherIds = [EXISTING_TEACHER_ID];
  for (const t of EXTRA_TEACHERS) {
    let user = await User.findOne({ school: SCHOOL_ID, email: t.email });
    if (!user) {
      user = await User.create({
        school: SCHOOL_ID,
        name: t.name,
        last_name: t.last_name,
        email: t.email,
        phoneNumber: t.phoneNumber,
        password: "teacher123",
        role: "teacher",
        isActive: true,
      });
      console.log(`   ✅ Created: ${t.name} ${t.last_name}`);
    } else {
      console.log(`   ⏭️  Exists: ${t.name} ${t.last_name}`);
    }
    teacherIds.push(String(user._id));
  }
  console.log(`   Teachers: ${teacherIds.join(", ")}`);

  // 3. CREAR SCHOOL SHIFT (Turno Matutino)
  console.log("\n🕐 Creating school shift...");
  let shift = await SchoolShift.findOne({ school: SCHOOL_ID, school_year_id: YEAR_ID });
  if (!shift) {
    shift = await SchoolShift.create({
      school: SCHOOL_ID,
      school_year_id: YEAR_ID,
      name: "Turno Matutino",
      shift: "matutino",
      startTime: "07:30",
      endTime: "13:30",
      moduleDurationMinutes: 50,
      timeBlocks: [
        { name: "Módulo 1", startTime: "07:30", endTime: "08:20", isBreak: false },
        { name: "Módulo 2", startTime: "08:20", endTime: "09:10", isBreak: false },
        { name: "Receso", startTime: "09:10", endTime: "09:30", isBreak: true },
        { name: "Módulo 3", startTime: "09:30", endTime: "10:20", isBreak: false },
        { name: "Módulo 4", startTime: "10:20", endTime: "11:10", isBreak: false },
        { name: "Receso", startTime: "11:10", endTime: "11:30", isBreak: true },
        { name: "Módulo 5", startTime: "11:30", endTime: "12:20", isBreak: false },
        { name: "Módulo 6", startTime: "12:20", endTime: "13:10", isBreak: false },
      ],
    });
    console.log(`   ✅ Created: ${shift.name} (${shift.timeBlocks.length} bloques)`);
  } else {
    console.log(`   ⏭️  Exists: ${shift.name}`);
  }

  // 4. CREAR PERÍODOS DE EVALUACIÓN
  console.log("\n📅 Creating grading periods...");
  const periodIds = [];
  for (const p of PERIODS) {
    let period = await GradingPeriod.findOne({ school: SCHOOL_ID, school_year_id: YEAR_ID, order: p.order });
    if (!period) {
      period = await GradingPeriod.create({
        school: SCHOOL_ID,
        school_year_id: YEAR_ID,
        name: p.name,
        order: p.order,
        startDate: new Date(p.startDate),
        endDate: new Date(p.endDate),
      });
      console.log(`   ✅ Created: ${p.name} (order: ${p.order})`);
    } else {
      console.log(`   ⏭️  Exists: ${p.name}`);
    }
    periodIds.push(period);
  }

  // 5. CREAR ASIGNACIONES (TeacherSubject)
  console.log("\n📋 Creating teacher-subject assignments...");
  const assignmentMap = new Map();
  for (let i = 0; i < MATERIAS.length; i++) {
    const m = MATERIAS[i];
    const teacherId = SCHEDULE[i].teacherIndex === 0 ? teacherIds[0] : teacherIds[1];
    const subjectId = subjectMap.get(m.code);

    let assignment = await TeacherSubject.findOne({
      school: SCHOOL_ID,
      teacher_id: teacherId,
      subject_id: subjectId._id,
      group_id: GROUP_ID,
      school_year_id: YEAR_ID,
    });

    if (!assignment) {
      assignment = await TeacherSubject.create({
        school: SCHOOL_ID,
        teacher_id: teacherId,
        subject_id: subjectId._id,
        group_id: GROUP_ID,
        school_year_id: YEAR_ID,
      });
      console.log(`   ✅ Assigned: ${m.name} → Teacher ${teacherId === teacherIds[0] ? "Juan" : "Extra"}`);
    } else {
      console.log(`   ⏭️  Exists: ${m.name} assignment`);
    }
    assignmentMap.set(m.code, { teacherId, subjectId });
  }

  // 6. CREAR HORARIOS (ClassSchedule)
  console.log("\n🗓️  Creating class schedules...");
  for (const sched of SCHEDULE) {
    const subjectId = subjectMap.get(sched.subjectCode)._id;
    const teacherId = assignmentMap.get(sched.subjectCode).teacherId;

    let classSchedule = await ClassSchedule.findOne({
      school: SCHOOL_ID,
      school_year_id: YEAR_ID,
      group_id: GROUP_ID,
      subject_id: subjectId,
      teacher_id: teacherId,
    });

    if (!classSchedule) {
      // Mapear blocks a timeBlockRefs del shift
      const scheduleSlots = sched.slots.map((slot) => ({
        dayOfWeek: slot.dayOfWeek,
        timeBlockRefs: slot.blocks.map((idx) => shift.timeBlocks[idx]._id),
      }));

      classSchedule = await ClassSchedule.create({
        school: SCHOOL_ID,
        school_year_id: YEAR_ID,
        group_id: GROUP_ID,
        subject_id: subjectId,
        teacher_id: teacherId,
        school_shift_id: shift._id,
        scheduleSlots,
      });
      console.log(`   ✅ Schedule: ${sched.subjectCode} (${sched.slots.length} días)`);
    } else {
      console.log(`   ⏭️  Exists: ${sched.subjectCode} schedule`);
    }
  }

  // 7. CREAR CALIFICACIONES T1
  console.log("\n📝 Creating grades (T1)...");
  const t1Period = periodIds.find((p) => p.order === 1);

  for (const g of GRADES_T1) {
    const subjectId = subjectMap.get(g.subjectCode)._id;

    let grade = await Grade.findOne({
      enrollment_id: ENROLLMENT_ID,
      subject_id: subjectId,
      gradingPeriod: t1Period._id,
    });

    if (!grade) {
      grade = await Grade.create({
        school: SCHOOL_ID,
        enrollment_id: ENROLLMENT_ID,
        school_year_id: YEAR_ID,
        subject_id: subjectId,
        gradingPeriod: t1Period._id,
        period_order: 1,
        value: g.value,
        graded_by: EXISTING_TEACHER_ID,
      });
      console.log(`   ✅ Grade: ${g.subjectCode} = ${g.value}`);
    } else {
      console.log(`   ⏭️  Exists: ${g.subjectCode} = ${grade.value}`);
    }
  }

  console.log("\n✨ Done! Data ready for the front.\n");

  // Resumen
  console.log("=== SUMMARY ===");
  console.log(`Subjects: ${MATERIAS.length}`);
  console.log(`Teachers: ${teacherIds.length}`);
  console.log(`Shift: ${shift.name} (${shift.timeBlocks.length} blocks)`);
  console.log(`Periods: ${PERIODS.length}`);
  console.log(`Schedules: ${SCHEDULE.length}`);
  console.log(`Grades: ${GRADES_T1.length}`);

  await mongoose.disconnect();
  console.log("\nDisconnected.");
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
