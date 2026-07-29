// Controlador de Calificaciones (Grade)
// CRUD sobre las notas de los estudiantes. Multi-tenant estricto.
// Las notas están vinculadas a la Enrollment del año (lo que garantiza
// la consistencia del ciclo).
const mongoose = require("mongoose");
const Grade = require("../models/Grade.model");
const Enrollment = require("../models/Enrollment.model");
const TeacherSubject = require("../models/TeacherSubject.model");
const {
  invalidateStudentDashboardCache,
} = require("../services/dashboard-cache.service");

// Helper: filtro de tenant según el role
const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

// POST /api/students/:studentId/grades
// Crea una nota. Requiere enrollment_id en el body (que valida pertenencia).
// Auth: teacher (maestro), admin, registrar, super_admin
// Si es teacher, se valida que tenga un TeacherSubject para (subject, group, year).
const createGrade = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { enrollment_id, subject, period, value, comments } = req.body;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: `No student with id: ${studentId}` });
    }
    if (!enrollment_id || !mongoose.Types.ObjectId.isValid(enrollment_id)) {
      return res.status(400).json({ message: "Valid enrollment_id is required." });
    }
    if (!subject || typeof subject !== "string" || !subject.trim()) {
      return res.status(400).json({ message: "subject is required." });
    }
    if (value === undefined || value === null || typeof value !== "number") {
      return res.status(400).json({ message: "value (number 0-10) is required." });
    }
    if (value < 0 || value > 10) {
      return res
        .status(400)
        .json({ message: "value must be between 0 and 10." });
    }
    const finalPeriod = period !== undefined ? period : 1;
    if (![0, 1, 2, 3].includes(finalPeriod)) {
      return res
        .status(400)
        .json({ message: "period must be 0, 1, 2 or 3." });
    }

    // Verificar que la Enrollment existe, pertenece al tenant, y al student
    const enrollment = await Enrollment.findOne({
      _id: enrollment_id,
      student_id: studentId,
      ...tenantFilter(req),
    }).populate("school_year_id", "name");
    if (!enrollment) {
      return res.status(404).json({
        message: "Enrollment not found for this student in this tenant.",
      });
    }
    if (enrollment.cycle_status !== "enrolled") {
      return res.status(400).json({
        message: `Cannot grade a student with cycle_status: ${enrollment.cycle_status}.`,
      });
    }

    // Si el usuario es teacher, validar que tenga TeacherSubject para
    // esta (subject, group, school_year). Admin/registrar/super_admin bypassean.
    if (req.payload.role === "teacher") {
      const assignment = await TeacherSubject.findOne({
        teacher_id: req.payload._id,
        subject: subject.trim(),
        group_id: enrollment.group_id,
        school_year_id: enrollment.school_year_id._id,
      });
      if (!assignment) {
        return res.status(403).json({
          message: `You are not assigned to teach "${subject}" to this group in ${enrollment.school_year_id.name}.`,
        });
      }
    }

    // Crear o actualizar (idempotente: si ya existe nota para esta
    // enrollment+subject+period, actualizamos el value)
    const filter = {
      enrollment_id,
      subject: subject.trim(),
      period: finalPeriod,
    };
    const update = {
      $set: {
        value,
        comments: comments || null,
        school: enrollment.school,
        school_year_id: enrollment.school_year_id._id,
        graded_by: req.payload._id,
        graded_at: new Date(),
      },
    };
    const options = { new: true, upsert: true, runValidators: true };

    const grade = await Grade.findOneAndUpdate(filter, update, options);

    res.status(201).json({
      message: "Grade saved successfully.",
      grade,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/students/:studentId/grades
// Lista las notas del student. Filtros opcionales: school_year_id, subject, period.
// Auth: staff (admin, registrar, teacher, etc.) o tutor dueño.
const getStudentGrades = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { school_year_id, subject, period } = req.query;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: `No student with id: ${studentId}` });
    }

    // Buscar las Enrollments del student (para multi-tenant)
    const enrollmentFilter = { student_id: studentId, ...tenantFilter(req) };
    const enrollments = await Enrollment.find(enrollmentFilter).select("_id");
    const enrollmentIds = enrollments.map((e) => e._id);

    if (enrollmentIds.length === 0) {
      return res.status(200).json({ items: [], total: 0 });
    }

    // Filtrar grades por enrollment + query params
    const gradeFilter = { enrollment_id: { $in: enrollmentIds } };
    if (school_year_id && mongoose.Types.ObjectId.isValid(school_year_id)) {
      gradeFilter.school_year_id = school_year_id;
    }
    if (subject) gradeFilter.subject = subject;
    if (period !== undefined) gradeFilter.period = parseInt(period, 10);

    const grades = await Grade.find(gradeFilter)
      .populate("enrollment_id", "group_id cycle_status")
      .populate("school_year_id", "name startDate endDate isActive")
      .populate("graded_by", "name email role")
      .sort({ subject: 1, period: 1 });

    // Orden final: ciclo más reciente primero (por startDate real, no por string)
    grades.sort((a, b) => {
      const aDate = a.school_year_id ? new Date(a.school_year_id.startDate) : 0;
      const bDate = b.school_year_id ? new Date(b.school_year_id.startDate) : 0;
      return bDate - aDate;
    });

    res.status(200).json({ items: grades, total: grades.length });
  } catch (error) {
    next(error);
  }
};

// GET /api/students/:studentId/grades/summary
// Resumen académico: promedio general, por materia, por período, por ciclo,
// y final de secundaria (3 años) si aplica. TODO se calcula on-the-fly desde
// los Grade crudos (no se almacenan promedios en la DB).
//
// Query params:
//   - school_year_id: ciclo específico (default: el más reciente del student, por startDate)
//   - period: 0/1/2/3 — filtra por trimestre; sin period devuelve todos
const getStudentGradesSummary = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { school_year_id, period } = req.query;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: `No student with id: ${studentId}` });
    }

    const enrollmentFilter = { student_id: studentId, ...tenantFilter(req) };
    if (school_year_id && mongoose.Types.ObjectId.isValid(school_year_id)) {
      enrollmentFilter.school_year_id = school_year_id;
    }
    const enrollments = await Enrollment.find(enrollmentFilter)
      .select("_id school_year_id")
      .populate("school_year_id", "name startDate");

    // Helper: calcula avg de un array de grades (ignora vacío)
    const avgOf = (arr) =>
      arr.length === 0 ? null : arr.reduce((s, g) => s + g.value, 0) / arr.length;

    // ===== by_year + final_grade: SIEMPRE se computan (across all years) =====
    // Buscar TODAS las Enrollments del student (no filtrar por year ni period)
    const allEnrollments = await Enrollment.find({
      student_id: studentId,
      ...tenantFilter(req),
    })
      .select("_id school_year_id")
      .populate("school_year_id", "name startDate");
    const allEnrollmentIds = allEnrollments.map((e) => e._id);
    const allGrades =
      allEnrollmentIds.length === 0
        ? []
        : await Grade.find({ enrollment_id: { $in: allEnrollmentIds } });

    // Map enrollment_id → SchoolYear (populado)
    const enrollmentYear = new Map();
    for (const e of allEnrollments) {
      if (e.school_year_id) enrollmentYear.set(String(e._id), e.school_year_id);
    }

    // by_year: promedio por ciclo escolar (agrupado por school_year_id)
    const byYearMap = new Map();
    for (const g of allGrades) {
      const sy = enrollmentYear.get(String(g.enrollment_id));
      if (!sy) continue;
      const key = String(sy._id);
      if (!byYearMap.has(key)) byYearMap.set(key, { schoolYear: sy, grades: [] });
      byYearMap.get(key).grades.push(g);
    }
    const byYear = [...byYearMap.values()]
      .sort((a, b) => new Date(a.schoolYear.startDate) - new Date(b.schoolYear.startDate))
      .map(({ schoolYear, grades }) => {
        const sum = grades.reduce((s, g) => s + g.value, 0);
        const avg = grades.length > 0 ? sum / grades.length : null;

        // by_period dentro de este año
        const periodMap = {};
        for (const g of grades) {
          if (!periodMap[g.period]) periodMap[g.period] = { sum: 0, count: 0 };
          periodMap[g.period].sum += g.value;
          periodMap[g.period].count += 1;
        }
        const byPeriodInYear = Object.entries(periodMap)
          .map(([p, { sum, count }]) => ({
            period: parseInt(p, 10),
            average: Math.round((sum / count) * 100) / 100,
            count,
          }))
          .sort((a, b) => a.period - b.period);

        return {
          school_year_id: schoolYear._id,
          school_year: schoolYear.name,
          average: avg !== null ? Math.round(avg * 100) / 100 : null,
          total_grades: grades.length,
          by_period: byPeriodInYear,
        };
      });

    // final_grade: promedio de los promedios anuales (3 años de secundaria)
    // Solo se computa si hay al menos 3 años con datos
    const yearAverages = byYear.map((y) => y.average).filter((a) => a !== null);
    const finalGrade =
      yearAverages.length >= 3
        ? Math.round(
            (yearAverages.reduce((s, a) => s + a, 0) / yearAverages.length) * 100
          ) / 100
        : null;

    // Helper: construye una respuesta "vacía" para el ciclo dado (o null)
    const emptySummary = (schoolYear) => ({
      school_year_id: schoolYear ? schoolYear._id : school_year_id || null,
      school_year: schoolYear ? schoolYear.name : null,
      period: period !== undefined ? parseInt(period, 10) : null,
      total_grades: 0,
      average: null,
      by_subject: [],
      by_period: [],
      highest: null,
      lowest: null,
      by_year: byYear,
      final_grade: finalGrade,
      total_years: byYear.length,
    });

    // ===== Ahora el "summary" del año/periodo específico =====
    if (enrollments.length === 0) {
      return res.status(200).json(emptySummary(null));
    }

    // El ciclo objetivo: el pedido (school_year_id) o el más reciente por startDate
    const sortedEnrollments = [...enrollments].sort(
      (a, b) =>
        new Date(b.school_year_id?.startDate || 0) -
        new Date(a.school_year_id?.startDate || 0)
    );
    const targetSchoolYear = school_year_id
      ? sortedEnrollments.find(
          (e) => String(e.school_year_id?._id) === String(school_year_id)
        )?.school_year_id
      : sortedEnrollments[0].school_year_id;

    if (!targetSchoolYear) {
      return res.status(200).json(emptySummary(null));
    }

    const targetEnrollmentIds = enrollments
      .filter(
        (e) => String(e.school_year_id?._id) === String(targetSchoolYear._id)
      )
      .map((e) => e._id);

    if (targetEnrollmentIds.length === 0) {
      return res.status(200).json(emptySummary(targetSchoolYear));
    }

    const gradeFilter = { enrollment_id: { $in: targetEnrollmentIds } };
    if (period !== undefined) gradeFilter.period = parseInt(period, 10);

    const grades = await Grade.find(gradeFilter);

    if (grades.length === 0) {
      return res.status(200).json(emptySummary(targetSchoolYear));
    }

    // Por materia
    const bySubjectMap = {};
    for (const g of grades) {
      if (!bySubjectMap[g.subject]) bySubjectMap[g.subject] = { sum: 0, count: 0 };
      bySubjectMap[g.subject].sum += g.value;
      bySubjectMap[g.subject].count += 1;
    }
    const bySubject = Object.entries(bySubjectMap)
      .map(([subject, { sum, count }]) => ({
        subject,
        average: sum / count,
        count,
      }))
      .sort((a, b) => b.average - a.average);

    // Por período
    const byPeriodMap = {};
    for (const g of grades) {
      if (!byPeriodMap[g.period]) byPeriodMap[g.period] = { sum: 0, count: 0 };
      byPeriodMap[g.period].sum += g.value;
      byPeriodMap[g.period].count += 1;
    }
    const byPeriod = Object.entries(byPeriodMap)
      .map(([p, { sum, count }]) => ({
        period: parseInt(p, 10),
        average: sum / count,
        count,
      }))
      .sort((a, b) => a.period - b.period);

    const highest = grades.reduce(
      (max, g) => (g.value > max.value ? g : max),
      grades[0]
    );
    const lowest = grades.reduce(
      (min, g) => (g.value < min.value ? g : min),
      grades[0]
    );

    res.status(200).json({
      school_year_id: targetSchoolYear._id,
      school_year: targetSchoolYear.name,
      period: period !== undefined ? parseInt(period, 10) : null,
      total_grades: grades.length,
      average: Math.round(avgOf(grades) * 100) / 100,
      by_subject: bySubject.map((s) => ({
        ...s,
        average: Math.round(s.average * 100) / 100,
      })),
      by_period: byPeriod.map((p) => ({
        ...p,
        average: Math.round(p.average * 100) / 100,
      })),
      highest: {
        subject: highest.subject,
        value: highest.value,
        period: highest.period,
      },
      lowest: {
        subject: lowest.subject,
        value: lowest.value,
        period: lowest.period,
      },
      by_year: byYear,
      final_grade: finalGrade,
      total_years: byYear.length,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/grades/:gradeId
const updateGrade = async (req, res, next) => {
  try {
    const { gradeId } = req.params;
    const { value, comments, period, subject } = req.body;

    if (!mongoose.Types.ObjectId.isValid(gradeId)) {
      return res.status(404).json({ message: `No grade with id: ${gradeId}` });
    }
    if (value !== undefined && (typeof value !== "number" || value < 0 || value > 10)) {
      return res
        .status(400)
        .json({ message: "value must be a number between 0 and 10." });
    }

    const grade = await Grade.findOne({
      _id: gradeId,
      ...tenantFilter(req),
    });
    if (!grade) {
      return res.status(404).json({ message: `No grade with id: ${gradeId}` });
    }

    const isAdmin = ["admin", "registrar", "super_admin"].includes(req.payload.role);
    if (!isAdmin && String(grade.graded_by) !== String(req.payload._id)) {
      return res.status(403).json({
        message: "Teachers can only edit their own grades.",
      });
    }

    if (value !== undefined) grade.value = value;
    if (comments !== undefined) grade.comments = comments;
    if (period !== undefined) grade.period = period;
    if (subject !== undefined) grade.subject = subject;
    grade.graded_by = req.payload._id;
    grade.graded_at = new Date();
    await grade.save();

    // Invalidar cache de los tutores afectados
    const enrUpd = await Enrollment.findById(grade.enrollment_id)
      .select("student_id")
      .lean();
    if (enrUpd) await invalidateStudentDashboardCache(enrUpd.student_id);

    res.status(200).json({ message: "Grade updated.", grade });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/grades/:gradeId
const deleteGrade = async (req, res, next) => {
  try {
    const { gradeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(gradeId)) {
      return res.status(404).json({ message: `No grade with id: ${gradeId}` });
    }
    // Buscar antes de borrar (necesitamos el student_id para invalidar cache)
    const toDelete = await Grade.findOne({
      _id: gradeId,
      ...tenantFilter(req),
    });
    if (!toDelete) {
      return res.status(404).json({ message: `No grade with id: ${gradeId}` });
    }
    const enrDel = await Enrollment.findById(toDelete.enrollment_id)
      .select("student_id")
      .lean();
    await Grade.deleteOne({ _id: gradeId });
    if (enrDel) await invalidateStudentDashboardCache(enrDel.student_id);
    res.status(200).json({ message: "Grade deleted successfully." });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createGrade,
  getStudentGrades,
  getStudentGradesSummary,
  updateGrade,
  deleteGrade,
};
