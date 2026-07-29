// Controlador de Guardian (Tutor)
// CRUD sobre la colección de tutores/guardianes. Tenant-scoped.
// El propio tutor puede consultar/editar su perfil; admin/registrar puede
// gestionar cualquier tutor de su escuela.
const mongoose = require("mongoose");
const Guardian = require("../models/Guardian.model");
const User = require("../models/User.model");
const Student = require("../models/Student.model");
const School = require("../models/School.model");
const Grade = require("../models/Grade.model");
const Enrollment = require("../models/Enrollment.model");
const AttendanceLog = require("../models/AttendanceLog.model");
const DisciplinaryReport = require("../models/DisciplinaryReport.model");
const cache = require("../services/cache.service");
const {
  getConductConfig,
} = require("../services/conduct.service");

const DASHBOARD_TTL = parseInt(process.env.CACHE_TTL_DASHBOARD || "300", 10); // esta linea de codigo es para que el tiempo de vida del cache sea configurable via variable de entorno, con un valor por defecto de 300 segundos (5 minutos) si no se especifica.

const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

const ADMIN_LIKE_ROLES = ["admin", "registrar", "super_admin"];

// Helper: valida que cada studentId exista, pertenezca a la misma escuela
// y (opcional) esté activo. Devuelve los docs o lanza error.
const validateStudentIds = async (studentIds, school) => {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return [];
  const validIds = studentIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length !== studentIds.length) {
    throw new Error("All student_ids must be valid ObjectIds.");
  }
  const students = await Student.find({
    _id: { $in: validIds },
    school,
  }).select("_id");
  if (students.length !== validIds.length) {
    throw new Error(
      "Some student_ids do not exist or belong to a different school."
    );
  }
  return validIds;
};

// GET /api/guardians
// Listar tutores. Filtros opcionales: user_id, student_id, search (por nombre/phone).
const getAllGuardians = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, user_id, student_id, search } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = { ...tenantFilter(req) };
    if (user_id && mongoose.Types.ObjectId.isValid(user_id)) {
      filter.user_id = user_id;
    }
    if (student_id && mongoose.Types.ObjectId.isValid(student_id)) {
      filter.students = student_id;
    }
    if (search) {
      const safe = String(search).trim();
      const regex = new RegExp(
        safe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      filter.$or = [{ name: regex }, { phone: regex }];
    }

    const skip = (pageNum - 1) * limitNum;
    const [items, total] = await Promise.all([
      Guardian.find(filter)
        .populate("user_id", "name email role isActive")
        .populate("students", "enrollment_number first_name last_name")
        .sort({ name: 1 })
        .skip(skip)
        .limit(limitNum),
      Guardian.countDocuments(filter),
    ]);

    res.status(200).json({
      items,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum) || 1,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/guardians/me
// Devuelve los guardianes del usuario autenticado (útil para el tutor).
const getMyGuardians = async (req, res, next) => {
  try {
    const items = await Guardian.find({
      ...tenantFilter(req),
      user_id: req.payload._id,
    }).populate("students", "enrollment_number first_name last_name");
    res.status(200).json({ items, total: items.length });
  } catch (error) {
    next(error);
  }
};

// POST /api/guardians
// Crea un tutor. Solo admin/registrar/super_admin.
// Body: { name, phone, relationship, school?, user_id?, students? }
const createGuardian = async (req, res, next) => {
  try {
    const { name, phone, relationship, user_id, students } = req.body;

    if (!name || !phone || !relationship) {
      return res
        .status(400)
        .json({ message: "name, phone, and relationship are required." });
    }
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ message: "phone must be 10 digits." });
    }

    // School: del body si lo pasan (super_admin), o del JWT
    const school = req.payload.schoolId || req.body.school;
    if (!school) {
      return res
        .status(400)
        .json({ message: "school is required (provide it in body for super_admin)." });
    }

    // Validar user_id si se pasa
    if (user_id) {
      if (!mongoose.Types.ObjectId.isValid(user_id)) {
        return res.status(400).json({ message: "Invalid user_id." });
      }
      const userExists = await User.findById(user_id);
      if (!userExists) {
        return res.status(404).json({ message: "User not found." });
      }
    }

    // Validar students
    let validStudents = [];
    if (students && students.length > 0) {
      try {
        validStudents = await validateStudentIds(students, school);
      } catch (e) {
        return res.status(400).json({ message: e.message });
      }
    }

    const newGuardian = await Guardian.create({
      school,
      name,
      phone,
      relationship,
      user_id: user_id || null,
      students: validStudents,
    });

    // Si tiene user_id, mantener simetría: agregar este guardian al User no aplica
    // porque User ya no tiene tutor_of_students. La fuente de verdad es Guardian.

    // Si tiene students, agregar este guardian al array guardians de cada Student
    if (validStudents.length > 0) {
      await Student.updateMany(
        { _id: { $in: validStudents } },
        { $addToSet: { guardians: newGuardian._id } }
      );
    }

    res.status(201).json(newGuardian);
  } catch (error) {
    next(error);
  }
};

// GET /api/guardians/:guardianId
const getGuardianById = async (req, res, next) => {
  try {
    const { guardianId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(guardianId)) {
      return res.status(404).json({ message: "Guardian not found." });
    }

    const guardian = await Guardian.findOne({
      _id: guardianId,
      ...tenantFilter(req),
    })
      .populate("user_id", "name email role isActive phoneNumber")
      .populate("students", "enrollment_number first_name last_name");

    if (!guardian) {
      return res.status(404).json({ message: "Guardian not found." });
    }

    res.status(200).json(guardian);
  } catch (error) {
    next(error);
  }
};

// PUT /api/guardians/:guardianId
// Solo el propio tutor o admin.
const updateGuardian = async (req, res, next) => {
  try {
    const { guardianId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(guardianId)) {
      return res.status(404).json({ message: "Guardian not found." });
    }

    const guardian = await Guardian.findOne({
      _id: guardianId,
      ...tenantFilter(req),
    });

    if (!guardian) {
      return res.status(404).json({ message: "Guardian not found." });
    }

    // Permisos: el User dueño del guardian, o admin
    const isOwner =
      guardian.user_id && String(guardian.user_id) === String(req.payload._id);
    const isAdmin = ADMIN_LIKE_ROLES.includes(req.payload.role);
    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ message: "Not authorized to update this guardian." });
    }

    // Validar phone si se actualiza
    if (req.body.phone !== undefined) {
      if (!/^\d{10}$/.test(req.body.phone)) {
        return res.status(400).json({ message: "phone must be 10 digits." });
      }
    }

    // Validar user_id si se actualiza
    if (req.body.user_id !== undefined && req.body.user_id !== null) {
      if (!mongoose.Types.ObjectId.isValid(req.body.user_id)) {
        return res.status(400).json({ message: "Invalid user_id." });
      }
      const userExists = await User.findById(req.body.user_id);
      if (!userExists) {
        return res.status(404).json({ message: "User not found." });
      }
    }

    // Validar students si se actualiza
    if (req.body.students !== undefined) {
      let validStudents = [];
      try {
        validStudents = await validateStudentIds(
          req.body.students,
          guardian.school
        );
      } catch (e) {
        return res.status(400).json({ message: e.message });
      }

      // Sincronizar el lado Student: quitar este guardian de los que ya no están
      // y agregarlo a los nuevos
      const oldStudents = guardian.students.map((s) => String(s));
      const newStudents = validStudents.map((s) => String(s));
      const toRemove = oldStudents.filter((s) => !newStudents.includes(s));
      const toAdd = newStudents.filter((s) => !oldStudents.includes(s));

      if (toRemove.length > 0) {
        await Student.updateMany(
          { _id: { $in: toRemove } },
          { $pull: { guardians: guardian._id } }
        );
      }
      if (toAdd.length > 0) {
        await Student.updateMany(
          { _id: { $in: toAdd } },
          { $addToSet: { guardians: guardian._id } }
        );
      }

      guardian.students = validStudents;
    }

    // Aplicar el resto de cambios (excepto students, ya manejado)
    const { students: _ignore, ...rest } = req.body;
    Object.assign(guardian, rest);
    await guardian.save();

    res.status(200).json(guardian);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/guardians/:guardianId
// Solo admin/registrar.
const deleteGuardian = async (req, res, next) => {
  try {
    const { guardianId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(guardianId)) {
      return res.status(404).json({ message: "Guardian not found." });
    }

    if (!ADMIN_LIKE_ROLES.includes(req.payload.role)) {
      return res
        .status(403)
        .json({ message: "Only admin/registrar can delete guardians." });
    }

    const guardian = await Guardian.findOneAndDelete({
      _id: guardianId,
      ...tenantFilter(req),
    });

    if (!guardian) {
      return res.status(404).json({ message: "Guardian not found." });
    }

    // Limpiar el lado Student: quitar este guardian del array guardians
    if (guardian.students && guardian.students.length > 0) {
      await Student.updateMany(
        { _id: { $in: guardian.students } },
        { $pull: { guardians: guardian._id } }
      );
    }

    res.status(200).json({ message: "Guardian deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// POST /api/guardians/me/fcm-token
// El tutor (autenticado) registra o actualiza el FCM token de su dispositivo
// móvil. Actualiza TODOS los Guardian records vinculados a su user_id
// (un tutor puede ser guardián de varios hijos → mismo fcm_token para todos).
// Body: { fcm_token: "abc123...", device_id?: "pixel-7" }
//
// NOTA PARA LA APP MÓVIL:
//   Firebase puede rotar el fcm_token mientras la app está instalada
//   (restore desde backup, reinstalación, etc.). La app DEBE suscribirse
//   al callback `onTokenRefresh` de Firebase Messaging y re-llamar a este
//   endpoint cada vez que reciba un token nuevo. Si no, los push dejan de
//   llegar silenciosamente cuando el token rotó.
const registerFcmToken = async (req, res, next) => {
  try {
    const { fcm_token, device_id } = req.body;

    if (!fcm_token || typeof fcm_token !== "string") {
      return res
        .status(400)
        .json({ message: "fcm_token is required and must be a string." });
    }

    // FCM tokens suelen ser > 100 chars de base64. Validación laxa.
    if (fcm_token.trim().length < 20) {
      return res
        .status(400)
        .json({ message: "fcm_token looks invalid (too short)." });
    }

    const result = await Guardian.updateMany(
      {
        user_id: req.payload._id,
        ...tenantFilter(req),
      },
      {
        $set: {
          fcm_token: fcm_token.trim(),
          ...(device_id ? { last_device_id: device_id } : {}),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        message: "No guardian records found for this user.",
      });
    }

    res.status(200).json({
      message: "FCM token registered successfully.",
      guardians_updated: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/guardians/me/fcm-token
// El tutor limpia su FCM token (logout, desinstalación, etc.) para dejar
// de recibir push. Pone fcm_token = null en todos sus Guardian records.
const clearFcmToken = async (req, res, next) => {
  try {
    const result = await Guardian.updateMany(
      {
        user_id: req.payload._id,
        ...tenantFilter(req),
      },
      { $set: { fcm_token: null } }
    );

    res.status(200).json({
      message: "FCM token cleared.",
      guardians_updated: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/guardians/me/students/:studentId/grades
// Devuelve las calificaciones de un hijo específico del tutor autenticado.
// Valida que el tutor sea Guardian del student (seguridad multi-tenant).
// Reutiliza la lógica del summary (promedio, by_subject, by_period,
// by_year, final_grade) — todo calculado on-the-fly.
//
// Query params opcionales:
//   - school_year_id: filtra por ciclo (default: el más reciente por startDate)
//   - period: 0/1/2/3 — filtra por trimestre
//   - subject: filtra por materia específica
const getMyStudentGrades = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { school_year_id, period, subject } = req.query;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: `No student with id: ${studentId}` });
    }

    // Validar que el tutor autenticado es Guardian de este student
    const isGuardian = await Guardian.findOne({
      user_id: req.payload._id,
      students: studentId,
    }).lean();
    if (!isGuardian) {
      return res.status(403).json({
        message: "You are not a guardian of this student.",
      });
    }

    // Buscar las Enrollments del student (multi-tenant)
    const enrollmentFilter = { student_id: studentId, ...tenantFilter(req) };
    const enrollments = await Enrollment.find(enrollmentFilter)
      .select("_id school_year_id group_id")
      .populate("school_year_id", "name startDate");
    if (enrollments.length === 0) {
      return res.status(200).json({
        student_id: studentId,
        items: [],
        summary: {
          total_grades: 0,
          average: null,
          by_subject: [],
          by_period: [],
          by_year: [],
          final_grade: null,
        },
      });
    }

    // Construir la lista de grades con filtros
    const enrollmentIds = enrollments.map((e) => e._id);
    const gradeFilter = { enrollment_id: { $in: enrollmentIds } };
    if (school_year_id && mongoose.Types.ObjectId.isValid(school_year_id)) {
      gradeFilter.school_year_id = school_year_id;
    }
    if (period !== undefined) gradeFilter.period = parseInt(period, 10);
    if (subject) gradeFilter.subject = subject;

    const grades = await Grade.find(gradeFilter)
      .populate("enrollment_id", "group_id cycle_status")
      .populate("school_year_id", "name startDate endDate isActive")
      .populate("graded_by", "name email role")
      .sort({ subject: 1, period: 1 });

    // Orden final: ciclo más reciente primero (por startDate real)
    grades.sort((a, b) => {
      const aDate = a.school_year_id ? new Date(a.school_year_id.startDate) : 0;
      const bDate = b.school_year_id ? new Date(b.school_year_id.startDate) : 0;
      return bDate - aDate;
    });

    // Calcular el summary del año específico (o el más reciente por startDate)
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
    const targetEnrollmentIds = targetSchoolYear
      ? enrollments
          .filter(
            (e) => String(e.school_year_id?._id) === String(targetSchoolYear._id)
          )
          .map((e) => e._id)
      : [];

    // Traer TODAS las grades del student (cross-year) para by_year y final_grade
    const allGrades = await Grade.find({
      enrollment_id: { $in: enrollmentIds },
    });

    // by_year
    const enrollmentYear = new Map();
    for (const e of enrollments) {
      if (e.school_year_id) enrollmentYear.set(String(e._id), e.school_year_id);
    }
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
      .map(({ schoolYear, grades: gs }) => {
        const sum = gs.reduce((s, g) => s + g.value, 0);
        const avg = gs.length > 0 ? sum / gs.length : null;
        const periodMap = {};
        for (const g of gs) {
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
          total_grades: gs.length,
          by_period: byPeriodInYear,
        };
      });

    const yearAverages = byYear.map((y) => y.average).filter((a) => a !== null);
    const finalGrade =
      yearAverages.length >= 3
        ? Math.round(
            (yearAverages.reduce((s, a) => s + a, 0) / yearAverages.length) * 100
          ) / 100
        : null;

    // Summary del año/periodo consultado
    const targetGrades = grades.filter((g) => {
      if (
        targetSchoolYear &&
        String(g.school_year_id?._id || g.school_year_id) !== String(targetSchoolYear._id)
      )
        return false;
      if (period !== undefined && g.period !== parseInt(period, 10)) return false;
      return true;
    });

    let summary = {
      school_year_id: targetSchoolYear ? targetSchoolYear._id : null,
      school_year: targetSchoolYear ? targetSchoolYear.name : null,
      total_grades: 0,
      average: null,
      by_subject: [],
      by_period: [],
    };
    if (targetGrades.length > 0) {
      const total = targetGrades.reduce((s, g) => s + g.value, 0);
      const average = total / targetGrades.length;
      const bySubjectMap = {};
      for (const g of targetGrades) {
        if (!bySubjectMap[g.subject]) bySubjectMap[g.subject] = { sum: 0, count: 0 };
        bySubjectMap[g.subject].sum += g.value;
        bySubjectMap[g.subject].count += 1;
      }
      const bySubject = Object.entries(bySubjectMap)
        .map(([s, { sum, count }]) => ({
          subject: s,
          average: sum / count,
          count,
        }))
        .sort((a, b) => b.average - a.average);
      const byPeriodMap = {};
      for (const g of targetGrades) {
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
      summary = {
        school_year_id: targetSchoolYear ? targetSchoolYear._id : null,
        school_year: targetSchoolYear ? targetSchoolYear.name : null,
        period: period !== undefined ? parseInt(period, 10) : null,
        total_grades: targetGrades.length,
        average: Math.round(average * 100) / 100,
        by_subject: bySubject.map((s) => ({
          ...s,
          average: Math.round(s.average * 100) / 100,
        })),
        by_period: byPeriod.map((p) => ({
          ...p,
          average: Math.round(p.average * 100) / 100,
        })),
      };
    }

    res.status(200).json({
      student_id: studentId,
      relationship: isGuardian.relationship,
      items: grades,
      summary: {
        ...summary,
        by_year: byYear,
        final_grade: finalGrade,
        total_years: byYear.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/guardians/me/dashboard
// Devuelve TODA la data que el front del tutor necesita para mostrar
// el dashboard en una sola request: perfil del padre, datos de la escuela
// (logo + nombre) y los estudiantes asignados.
//
// Auth: cualquier user autenticado (típicamente role=tutor; super_admin
// también puede ver su propio dashboard que devolvería sin estudiantes).
const getMyDashboard = async (req, res, next) => {
  try {
    // Cache key por userId + period
    const cacheKey = cache.keys.dashboard(req.payload._id, req.query.period);
    const cached = await cache.get(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.status(200).json(cached);
    }

    // 1. Perfil del User
    const user = await User.findById(req.payload._id)
      .select("name email phoneNumber role school isActive")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // 2. Datos de la escuela
    let school = null;
    let currentSchoolYear = null;
    if (user.school) {
      school = await School.findById(user.school)
        .select("name cct logoUrl isActive current_school_year_id")
        .populate("current_school_year_id", "name startDate endDate isActive")
        .lean();
      currentSchoolYear = school ? school.current_school_year_id : null;
    }

    // 3. Estudiantes asignados
    //    Buscamos los Guardian records del user, colectamos los student_ids
    //    y luego hacemos un solo find() con populate del current_group_id.
    const guardianRecords = await Guardian.find({
      user_id: req.payload._id,
    })
      .select("students relationship")
      .lean();

    // Aplanar la lista de student_ids (puede haber duplicados si el tutor
    // tiene 2+ Guardian records apuntando al mismo student — los deduplicamos)
    const studentIdSet = new Set();
    const relationshipByStudent = new Map();
    for (const g of guardianRecords) {
      if (!g.students) continue;
      for (const sid of g.students) {
        const key = String(sid);
        studentIdSet.add(key);
        // Si un student tiene múltiples relationships, priorizamos la primera
        if (!relationshipByStudent.has(key)) {
          relationshipByStudent.set(key, g.relationship);
        }
      }
    }

    let students = [];
    if (studentIdSet.size > 0) {
      // Filtrar por tenant (no devolver estudiantes de otras escuelas)
      const studentFilter = {
        _id: { $in: [...studentIdSet] },
      };
      if (req.payload.role !== "super_admin" && user.school) {
        studentFilter.school = user.school;
      }

      let studentDocs = await Student.find(studentFilter)
        .select("enrollment_number first_name last_name status photoUrl current_group_id school")
        .populate({
          path: "current_group_id",
          select: "grade section school_year_id shift",
          populate: { path: "school_year_id", select: "name startDate endDate isActive" },
        })
        .sort({ last_name: 1, first_name: 1 })
        .lean();

      // Nota: NO filtramos/excluimos students cuyo current_group_id no
      // coincida con el ciclo activo — el tutor siempre debe ver a sus
      // hijos en el dashboard. El grado/grupo del ciclo actual se resuelve
      // abajo a partir de la Enrollment del ciclo (fuente de verdad); si no
      // existe, se usa current_group_id como fallback (ver paso 3b).

      // Capitalizar la primera letra del shift para mostrar "Matutino"
      const capitalize = (s) =>
        s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

      // Enriquecer con la relationship del tutor
      students = studentDocs.map((s) => {
        const g = s.current_group_id;
        const groupLabel =
          g && g.grade && g.section && g.shift
            ? `${g.grade}°${g.section} - Turno ${capitalize(g.shift)}`
            : null;
        return {
          _id: s._id,
          enrollment_number: s.enrollment_number,
          first_name: s.first_name,
          last_name: s.last_name,
          status: s.status,
          photo_url: s.photoUrl,
          // Datos de grado/grupo del estudiante (fallback desde
          // Student.current_group_id). Se sobrescribe abajo (paso 3b) con la
          // Enrollment del ciclo escolar activo, que es la fuente de verdad.
          // Si el student no tiene current_group_id, queda en null.
          current_group: g
            ? {
                _id: g._id,
                grade: g.grade,
                section: g.section,
                school_year_id: g.school_year_id ? g.school_year_id._id : null,
                school_year: g.school_year_id ? g.school_year_id.name : null,
                shift: g.shift,
              }
            : null,
          // Label pre-formateado para mostrar en el front sin transformar
          group_label: groupLabel,
          relationship: relationshipByStudent.get(String(s._id)) || null,
          // academic_summary se agrega abajo (después del batch query)
          academic_summary: null,
          // last_event: se agrega abajo (después del batch query)
          last_event: null,
          // KPIs del Guardian Dashboard. Se inicializan con valores neutros
          // y se sobreescriben en los bloques 3b/3c con los datos reales.
          kpis: {
            attendance: {
              percentage: null,
              attended_days: 0,
              total_school_days: 0,
              source: null,
            },
            cumulative_gpa: null,
            conduct: {
              score: null,
              baseline: null,
              deduction: 0,
              reports_count: 0,
              floor: null,
            },
          },
        };
      });

      // 3a. Último evento de asistencia por student — 1 query batch
      if (students.length > 0) {
        const studentIds = students.map((s) => s._id);
        // Aggregation: para cada student, el evento más reciente
        const latestEvents = await AttendanceLog.aggregate([
          { $match: { student_id: { $in: studentIds } } },
          { $sort: { event_time: -1 } },
          {
            $group: {
              _id: "$student_id",
              event_type: { $first: "$event_type" },
              event_time: { $first: "$event_time" },
              device: { $first: "$device" },
            },
          },
        ]);
        const eventByStudent = new Map();
        for (const ev of latestEvents) {
          eventByStudent.set(String(ev._id), {
            event_type: ev.event_type,
            // Label legible para mostrar directo en el front sin transformar
            event_type_label: ev.event_type === "entry" ? "Entrada" : "Salida",
            event_time: ev.event_time,
            device: ev.device || null,
            // is_currently_in_institution: derivado
            // entry = "dentro", exit = "fuera"
            is_currently_in_institution: ev.event_type === "entry",
          });
        }
        for (const s of students) {
          s.last_event = eventByStudent.get(String(s._id)) || null;
        }
      }

      // 3b. Grupo del ciclo actual + resumen académico (PROM.) — 1 query batch
      if (students.length > 0) {
        const studentIds = students.map((s) => s._id);
        // Buscar las Enrollments de estos students (del año activo o de todos
        // si no hay year activo)
        const enrollmentFilter = { student_id: { $in: studentIds } };
        if (currentSchoolYear) enrollmentFilter.school_year_id = currentSchoolYear._id;
        const enrollments = await Enrollment.find(enrollmentFilter)
          .select("_id student_id school_year_id group_id")
          .populate("school_year_id", "name")
          .populate("group_id", "grade section shift");
        const enrollmentByStudent = new Map();
        for (const e of enrollments) {
          // Si hay múltiples Enrollments del mismo student (raro), tomar la del año actual
          if (
            !enrollmentByStudent.has(String(e.student_id)) ||
            (currentSchoolYear && String(e.school_year_id?._id) === String(currentSchoolYear._id))
          ) {
            enrollmentByStudent.set(String(e.student_id), e);
          }
        }

        // Grado/grupo del ciclo actual: la Enrollment es la fuente de verdad
        // (no Student.current_group_id, que puede quedar desactualizado).
        // Si el student no tiene Enrollment para el ciclo activo, se deja el
        // fallback que ya trae current_group_id (ver mapeo inicial de students).
        const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
        for (const student of students) {
          const enr = enrollmentByStudent.get(String(student._id));
          const g = enr ? enr.group_id : null;
          if (!g) continue; // sin Enrollment de este ciclo: se conserva el fallback
          student.current_group = {
            _id: g._id,
            grade: g.grade,
            section: g.section,
            school_year_id: enr.school_year_id ? enr.school_year_id._id : null,
            school_year: enr.school_year_id ? enr.school_year_id.name : null,
            shift: g.shift,
          };
          student.group_label =
            g.grade && g.section && g.shift
              ? `${g.grade}°${g.section} - Turno ${capitalize(g.shift)}`
              : null;
        }

        // Buscar las grades de esas Enrollments (1 query)
        const enrollmentIds = enrollments.map((e) => e._id);
        const grades = await Grade.find({
          enrollment_id: { $in: enrollmentIds },
        }).select("enrollment_id value subject period school_year_id");

        // Agrupar grades por student_id
        const gradesByStudent = new Map();
        for (const e of enrollments) {
          if (!gradesByStudent.has(String(e.student_id))) {
            gradesByStudent.set(String(e.student_id), []);
          }
        }
        const enrollmentToStudent = new Map();
        const enrollmentYear = new Map();
        for (const e of enrollments) {
          enrollmentToStudent.set(String(e._id), String(e.student_id));
          enrollmentYear.set(String(e._id), e.school_year_id);
        }
        for (const g of grades) {
          const sid = enrollmentToStudent.get(String(g.enrollment_id));
          if (sid) {
            gradesByStudent.get(sid).push(g);
          }
        }

        // Calcular el resumen para cada student
        const studentMap = new Map(students.map((s) => [String(s._id), s]));
        for (const [sid, gs] of gradesByStudent) {
          const student = studentMap.get(sid);
          if (!student) continue;
          if (gs.length === 0) {
            student.academic_summary = {
              school_year_id: currentSchoolYear ? currentSchoolYear._id : null,
              school_year: currentSchoolYear ? currentSchoolYear.name : null,
              total_grades: 0,
              average: null,
              status: "no_grades",
            };
            // cumulative_gpa ya está en null por la inicialización
            continue;
          }
          const sum = gs.reduce((s, g) => s + g.value, 0);
          const average = sum / gs.length;
          // Por materia
          const bySubject = {};
          for (const g of gs) {
            if (!bySubject[g.subject]) bySubject[g.subject] = { sum: 0, count: 0 };
            bySubject[g.subject].sum += g.value;
            bySubject[g.subject].count += 1;
          }
          const bestSubject = Object.entries(bySubject)
            .map(([subject, { sum, count }]) => ({
              subject,
              average: sum / count,
            }))
            .sort((a, b) => b.average - a.average)[0];

          // Promedio Acumulado (KPI #2): media de los promedios por
          // trimestre EVALUADO. Un trimestre cuenta como evaluado si tiene
          // >= 1 Grade en period ∈ {1,2,3}. Si ninguno evaluado → null.
          // period=0 (calificación final de año) NO se incluye aquí.
          const trimesterBuckets = { 1: { sum: 0, count: 0 }, 2: { sum: 0, count: 0 }, 3: { sum: 0, count: 0 } };
          for (const g of gs) {
            if (g.period === 1 || g.period === 2 || g.period === 3) {
              trimesterBuckets[g.period].sum += g.value;
              trimesterBuckets[g.period].count += 1;
            }
          }
          const evaluatedAverages = [1, 2, 3]
            .map((p) => trimesterBuckets[p])
            .filter((b) => b.count > 0)
            .map((b) => b.sum / b.count);
          if (evaluatedAverages.length > 0) {
            const cumulative =
              evaluatedAverages.reduce((acc, v) => acc + v, 0) /
              evaluatedAverages.length;
            student.kpis.cumulative_gpa = Math.round(cumulative * 100) / 100;
          }

          const fallbackYear = enrollmentYear.get(String(gs[0].enrollment_id));
          student.academic_summary = {
            school_year_id: currentSchoolYear
              ? currentSchoolYear._id
              : fallbackYear?._id || null,
            school_year: currentSchoolYear
              ? currentSchoolYear.name
              : fallbackYear?.name || null,
            total_grades: gs.length,
            average: Math.round(average * 100) / 100,
            best_subject: bestSubject
              ? { subject: bestSubject.subject, average: Math.round(bestSubject.average * 100) / 100 }
              : null,
            // Detalle por trimestre (útil para el front aunque no se use hoy)
            by_trimester: [1, 2, 3].map((p) => {
              const b = trimesterBuckets[p];
              return {
                period: p,
                average: b.count > 0 ? Math.round((b.sum / b.count) * 100) / 100 : null,
                evaluated: b.count > 0,
                grades_count: b.count,
              };
            }),
            evaluated_trimesters: evaluatedAverages.length,
            status: "ok",
          };
        }
      }

      // 3c. KPIs del Guardian Dashboard — attendance % y conduct score.
      // cumulative_gpa ya se calculó dentro del bloque 3b (necesita las grades
      // en memoria). Acá calculamos los otros dos con batches paralelos.
      if (students.length > 0 && currentSchoolYear && school) {
        const studentIds = students.map((s) => s._id);
        const schoolId = school._id;
        const yearId = currentSchoolYear._id;
        const yearStart = currentSchoolYear.startDate
          ? new Date(currentSchoolYear.startDate)
          : null;
        const now = new Date();

        // ----- KPI #1: % Asistencia -----
        // Denominador: días distintos del ciclo en los que la escuela
        // tuvo AL MENOS 1 evento de asistencia (proxy de "día lectivo").
        // Esto funciona sin un SchoolDay explícito; si en el futuro se
        // agrega un calendario escolar formal, se prefiere ese lookup.
        const dateRangeMatch = yearStart
          ? { $gte: yearStart, $lte: now }
          : { $lte: now };

        const tenantDaysAgg = await AttendanceLog.aggregate([
          { $match: { school: schoolId, event_time: dateRangeMatch } },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$event_time" },
              },
            },
          },
        ]);
        const totalSchoolDays = tenantDaysAgg.length;
        const tenantDaySet = new Set(tenantDaysAgg.map((d) => d._id));

        if (totalSchoolDays > 0) {
          // Días con al menos 1 'entry' por estudiante (dentro del ciclo)
          const studentEntryDaysAgg = await AttendanceLog.aggregate([
            {
              $match: {
                school: schoolId,
                student_id: { $in: studentIds },
                event_type: "entry",
                event_time: dateRangeMatch,
              },
            },
            {
              $group: {
                _id: {
                  student: "$student_id",
                  day: {
                    $dateToString: { format: "%Y-%m-%d", date: "$event_time" },
                  },
                },
              },
            },
          ]);
          // Set de días-entry por student
          const studentDaySet = new Map();
          for (const row of studentEntryDaysAgg) {
            const key = String(row._id.student);
            if (!studentDaySet.has(key)) studentDaySet.set(key, new Set());
            studentDaySet.get(key).add(row._id.day);
          }
          for (const s of students) {
            const daySet = studentDaySet.get(String(s._id)) || new Set();
            // Intersección: solo cuentan los días que la escuela SÍ tuvo
            // evento Y el alumno tuvo un entry
            let attended = 0;
            for (const d of daySet) {
              if (tenantDaySet.has(d)) attended += 1;
            }
            const percentage = Math.round((attended / totalSchoolDays) * 10000) / 100;
            s.kpis.attendance = {
              percentage,
              attended_days: attended,
              total_school_days: totalSchoolDays,
              source: "derived_from_attendance_logs",
            };
          }
        }
        // Si totalSchoolDays == 0, dejamos los defaults (null) ya inicializados

        // ----- KPI #3: Score de Conducta -----
        // score = max(baseline - sum(points_deduction de reportes activos del año), floor)
        const conductConfig = await getConductConfig(schoolId);
        const conductAgg = await DisciplinaryReport.aggregate([
          {
            $match: {
              school: schoolId,
              student_id: { $in: studentIds },
              school_year_id: yearId,
              status: "active",
            },
          },
          {
            $group: {
              _id: "$student_id",
              deduction: { $sum: "$points_deduction" },
              count: { $sum: 1 },
            },
          },
        ]);
        const conductByStudent = new Map(
          conductAgg.map((c) => [
            String(c._id),
            { deduction: c.deduction, count: c.count },
          ])
        );
        for (const s of students) {
          const c = conductByStudent.get(String(s._id)) || {
            deduction: 0,
            count: 0,
          };
          const rawScore = conductConfig.baseline - c.deduction;
          const score = Math.max(conductConfig.floor, rawScore);
          s.kpis.conduct = {
            score,
            baseline: conductConfig.baseline,
            deduction: c.deduction,
            reports_count: c.count,
            floor: conductConfig.floor,
          };
        }
      }
    }

    // 4. Stats básicos (útiles para el dashboard)
    const total = students.length;
    const active = students.filter((s) => s.status === "active").length;
    const inactive = total - active;

    // Construir la response una sola vez (para cachear y responder)
    const responseBody = {
      user: {
        _id: user._id,
        name: user.name,
        last_name: user.last_name,
        // Saludo pre-formateado para mostrar directo en el front.
        // Si el user no tiene last_name, mostramos solo el name.
        greeting: user.last_name
          ? `${user.name} ${user.last_name}`
          : user.name,
        email: user.email,
        phone_number: user.phoneNumber,
        role: user.role,
        is_active: user.isActive,
      },
      school: school
        ? {
            _id: school._id,
            name: school.name,
            cct: school.cct,
            logo_url: school.logoUrl,
            is_active: school.isActive,
            current_school_year_id: currentSchoolYear ? currentSchoolYear._id : null,
            current_school_year: currentSchoolYear ? currentSchoolYear.name : null,
          }
        : null,
      students,
      stats: {
        total_students: total,
        active_students: active,
        inactive_students: inactive,
      },
    };

    // Guardar en cache (best-effort: si Redis no está, el response sale igual)
    await cache.set(cacheKey, responseBody, DASHBOARD_TTL);
    res.setHeader("X-Cache", "MISS");
    console.log("Datos del body",responseBody);
    return res.status(200).json(responseBody);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllGuardians,
  getMyGuardians,
  createGuardian,
  getGuardianById,
  updateGuardian,
  deleteGuardian,
  registerFcmToken,
  clearFcmToken,
  getMyDashboard,
  getMyStudentGrades,
};
