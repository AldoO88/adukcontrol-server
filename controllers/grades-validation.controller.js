// Controller de Validación de Calificaciones
// GET /api/teacher-subjects/me/grades/validation
//
// Devuelve el estado de cierre de cada (grupo, materia) asignado al maestro
// para un período dado. Incluye el progreso global (% cerrado) y el detalle
// por combo: promedio del grupo, status (closed/review/pending) y closedAt.
//
// Status:
//   - closed: existe un GradeClosing para el combo
//   - pending: NO hay EvaluationType definidos (maestro aún no armó la tabla)
//   - review: hay EvaluationType pero faltan notas (al menos un student × evalType sin value)
const mongoose = require("mongoose");
const TeacherSubject = require("../models/TeacherSubject.model");
const GradingPeriod = require("../models/GradingPeriod.model");
const EvaluationType = require("../models/EvaluationType.model");
const EvaluationGrade = require("../models/EvaluationGrade.model");
const GradeRule = require("../models/GradeRule.model");
const GradeClosing = require("../models/GradeClosing.model");
const Enrollment = require("../models/Enrollment.model");
const Student = require("../models/Student.model");

// Promedio del grupo y promedios individuales.
// Devuelve { groupAverage, studentAverages } donde studentAverages
// es un Map<studentId, { average, hasGrades }>.
// Recibe studentIds para incluir también a alumnos sin notas capturadas
// (necesario para que ungradedCount sea correcto en grupos taller).
const computeGroupAverage = (grades, evalTypes, averagingRule, studentIds) => {
  const gradesMap = {};
  for (const g of grades) {
    const sid = String(g.student_id);
    const eid = String(g.evaluation_type_id);
    if (!gradesMap[sid]) gradesMap[sid] = {};
    gradesMap[sid][eid] = g.value;
  }

  // Inicializar en gradesMap a todos los students, incluyendo los que
  // no tienen ninguna nota. Así aparecen en studentAverages con
  // hasGrades: false y ungradedCount se calcula correctamente.
  for (const sid of studentIds) {
    const key = String(sid);
    if (!gradesMap[key]) gradesMap[key] = {};
  }

  const studentAverages = new Map();
  const studentAvgs = [];
  for (const sid in gradesMap) {
    let totalNormal = 0,
      totalWeighted = 0,
      totalPercentage = 0,
      totalExtra = 0,
      hasGrades = false;

    for (const et of evalTypes) {
      const value = gradesMap[sid][String(et._id)];
      if (value === undefined || value === null) continue;
      hasGrades = true;
      if (et.type === "normal") {
        if (averagingRule === "weighted" && et.percentage) {
          totalWeighted += (value * et.percentage) / 100;
          totalPercentage += et.percentage;
        } else {
          totalNormal += value;
        }
      } else if (et.type === "extra") {
        totalExtra += value;
      }
    }

    if (hasGrades) {
      let avg;
      if (averagingRule === "weighted" && totalPercentage > 0) {
        avg = totalWeighted + totalExtra;
      } else {
        const normalCount = evalTypes.filter(
          (et) =>
            et.type === "normal" &&
            gradesMap[sid][String(et._id)] !== undefined
        ).length;
        avg = normalCount > 0 ? totalNormal / normalCount + totalExtra : totalExtra;
      }
      const clamped = Math.round(Math.min(avg, 10) * 10) / 10;
      studentAverages.set(sid, { average: clamped, hasGrades: true });
      studentAvgs.push(clamped);
    } else {
      studentAverages.set(sid, { average: null, hasGrades: false });
    }
  }

  let groupAverage = null;
  if (studentAvgs.length > 0) {
    const sum = studentAvgs.reduce((a, b) => a + b, 0);
    groupAverage = Math.round((sum / studentAvgs.length) * 10) / 10;
  }
  return { groupAverage, studentAverages };
};

const getGradesValidation = async (req, res, next) => {
  try {
    const { grading_period_id: periodId } = req.query;
    const teacherId = req.payload._id;
    const schoolId = req.school;
    const schoolYearId = req.schoolYear;

    // 1. Validar query
    if (!periodId || !mongoose.Types.ObjectId.isValid(periodId)) {
      return res.status(400).json({
        message: "grading_period_id is required and must be a valid ObjectId.",
      });
    }

    // 2. Buscar el período (validar tenant)
    const gradingPeriod = await GradingPeriod.findOne({
      _id: periodId,
      school: schoolId,
      school_year_id: schoolYearId,
    }).lean();

    if (!gradingPeriod) {
      return res.status(404).json({ message: "Grading period not found." });
    }

    // 3. Asignaciones del maestro (incluye talleres)
    const assignments = await TeacherSubject.find({
      school: schoolId,
      teacher_id: teacherId,
      school_year_id: schoolYearId,
    })
      .populate("group_id", "grade section shift type school_year_id")
      .populate(
        "subject_id",
        "code name macroCategory isTutoria classificationType color icon"
      )
      .lean();

    // 4. Deduplicar combos (un maestro puede tener 2 TeacherSubject al mismo combo)
    const uniqueCombos = new Map();
    for (const a of assignments) {
      if (!a.group_id || !a.subject_id) continue;
      const key = `${a.group_id._id}_${a.subject_id._id}`;
      if (!uniqueCombos.has(key)) uniqueCombos.set(key, a);
    }

    // 5. Cierres del maestro en este período (1 sola query)
    const closings = await GradeClosing.find({
      school: schoolId,
      teacher_id: teacherId,
      period_id: gradingPeriod._id,
    })
      .select("group_id subject_id closedAt")
      .lean();
    const closingMap = new Map();
    for (const c of closings) {
      closingMap.set(`${c.group_id}_${c.subject_id}`, c.closedAt);
    }

    // 6. Procesar cada combo EN PARALELO
    const groups = await Promise.all(
      [...uniqueCombos.values()].map(async (a) => {
        const groupId = a.group_id._id;
        const subjectId = a.subject_id._id;
        const comboKey = `${groupId}_${subjectId}`;

        const isTaller = a.group_id.type === "taller";

        // 6a. EvaluationType + GradeRule en paralelo
        const [evalTypes, rule] = await Promise.all([
          EvaluationType.find({
            school: schoolId,
            school_year_id: schoolYearId,
            group_id: groupId,
            subject_id: subjectId,
            period_id: gradingPeriod._id,
            teacher_id: teacherId,
          })
            .select("_id type percentage")
            .lean(),
          GradeRule.findOne({
            school: schoolId,
            school_year_id: schoolYearId,
            group_id: groupId,
            subject_id: subjectId,
            period_id: gradingPeriod._id,
            teacher_id: teacherId,
          }).lean(),
        ]);

        const evalTypeIds = evalTypes.map((e) => e._id);

        // 6b. Resolver alumnos: taller → Student.workshop_group_id, regular → Enrollment.group_id
        let enrollmentCount = 0;
        let studentIds = [];

        if (isTaller) {
          const tallerStudents = await Student.find({
            school: schoolId,
            status: "active",
            workshop_group_id: groupId,
          })
            .select("_id")
            .lean();
          studentIds = tallerStudents.map((s) => s._id);
          enrollmentCount = studentIds.length;
        } else {
          const enrollments = await Enrollment.find({
            school: schoolId,
            group_id: groupId,
            school_year_id: schoolYearId,
            cycle_status: "enrolled",
          })
            .select("student_id")
            .lean();
          studentIds = enrollments.map((e) => e.student_id);
          enrollmentCount = studentIds.length;
        }

        // 6c. Determinar status
        let status;
        let closedAt = null;
        if (closingMap.has(comboKey)) {
          status = "closed";
          closedAt = closingMap.get(comboKey);
        } else if (evalTypeIds.length === 0) {
          status = "pending";
        } else {
          status = "review";
        }

        // 6e. Promedio del grupo + promedios individuales
        let average = null;
        let studentAverages = new Map();
        if (evalTypeIds.length > 0 && studentIds.length > 0) {
          const averagingRule = rule ? rule.averagingRule : "simple";

          const grades = await EvaluationGrade.find({
            school: schoolId,
            evaluation_type_id: { $in: evalTypeIds },
            student_id: { $in: studentIds },
          }).lean();

          const result = computeGroupAverage(grades, evalTypes, averagingRule, studentIds);
          average = result.groupAverage;
          studentAverages = result.studentAverages;
        }

        // 6e. Estadísticas de alumnos
        let atRiskCount = 0;
        let failedCount = 0;
        let ungradedCount = 0;

        if (status === "pending") {
          // Sin tipos de evaluación definidos → todos los alumnos están sin notas.
          ungradedCount = enrollmentCount;
        } else {
          for (const { average: sAvg, hasGrades } of studentAverages.values()) {
            if (!hasGrades) { ungradedCount++; continue; }
            if (sAvg < 6) failedCount++;
            else if (sAvg <= 7) atRiskCount++;
          }
        }

        return {
          _id: groupId,
          group: {
            _id: groupId,
            label: `${a.group_id.grade}°${a.group_id.section}`,
            grade: a.group_id.grade,
            section: a.group_id.section,
            type: a.group_id.type || "regular",
          },
          subject: {
            _id: subjectId,
            name: a.subject_id.name,
            code: a.subject_id.code,
            macroCategory: a.subject_id.macroCategory || null,
            isTutoria: a.subject_id.isTutoria || false,
            color: a.subject_id.color || null,
            icon: a.subject_id.icon || null,
          },
          average,
          status,
          closedAt,
          studentStats: {
            atRiskCount,
            failedCount,
            ungradedCount,
            totalStudents: enrollmentCount,
          },
        };
      })
    );

    // 7. Progress
    const totalGroups = groups.length;
    const closedGroups = groups.filter((g) => g.status === "closed").length;
    const progress = {
      totalGroups,
      closedGroups,
      percentage:
        totalGroups > 0 ? Math.round((closedGroups / totalGroups) * 100) : 0,
    };

    res.status(200).json({
      gradingPeriod: {
        _id: gradingPeriod._id,
        name: gradingPeriod.name,
        order: gradingPeriod.order,
        startDate: gradingPeriod.startDate,
        endDate: gradingPeriod.endDate,
        isClosed: gradingPeriod.isClosed,
      },
      progress,
      groups,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getGradesValidation };
