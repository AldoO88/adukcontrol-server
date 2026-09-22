// Controlador del Dashboard Super Admin
// Proporciona estadísticas agregadas para el panel principal.
const mongoose = require("mongoose");
const School = require("../models/School.model");
const User = require("../models/User.model");
const Student = require("../models/Student.model");
const SchoolYear = require("../models/SchoolYear.model");
const SchoolShift = require("../models/SchoolShift.model");
const SchoolCalendar = require("../models/SchoolCalendar.model");
const Subject = require("../models/Subject.model");
const Group = require("../models/Group.model");
const ClassSchedule = require("../models/ClassSchedule.model");
const TeacherSubject = require("../models/TeacherSubject.model");

// GET /api/dashboard/super-admin
// Devuelve stats agregados y lista de escuelas con datos resumen.
// Auth: super_admin solamente.
const getSuperAdminDashboard = async (req, res, next) => {
  try {
    // Conteos globales
    const [totalSchools, activeSchools, totalUsers, totalStudents] =
      await Promise.all([
        School.countDocuments(),
        School.countDocuments({ isActive: true }),
        User.countDocuments({ role: { $ne: "super_admin" } }),
        Student.countDocuments({ status: "active" }),
      ]);

    // Usuarios creados este mes
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const usersThisMonth = await User.countDocuments({
      createdAt: { $gte: firstDayOfMonth },
      role: { $ne: "super_admin" },
    });

    // Ciclo escolar más reciente activo (para mostrar nombre)
    const activeYear = await SchoolYear.findOne({ isActive: true })
      .sort({ createdAt: -1 })
      .select("name")
      .lean();
    const schoolYearName = activeYear?.name || "—";

    // Datos por escuela
    const schools = await School.find()
      .sort({ createdAt: -1 })
      .select("name cct isActive logoUrl honoraryName current_school_year_id")
      .lean();

    const schoolsList = await Promise.all(
      schools.map(async (school) => {
        // Turnos del ciclo activo de esta escuela
        const schoolYearForShifts = school.current_school_year_id;
        const shifts = schoolYearForShifts
          ? await SchoolShift.find({
              school: school._id,
              school_year_id: schoolYearForShifts,
            })
              .select("shift moduleDurationMinutes")
              .lean()
          : [];

        const shiftNames = [
          ...new Set(shifts.map((s) => (s.shift === "matutino" ? "Matutino" : "Vespertino"))),
        ];
        const classDuration =
          shifts.length > 0 ? shifts[0].moduleDurationMinutes : null;

        // Conteos por escuela
        const [staffCount, teachersCount, studentsCount, groupsCount] =
          await Promise.all([
            User.countDocuments({ school: school._id, role: { $ne: "super_admin" } }),
            User.countDocuments({ school: school._id, role: "teacher" }),
            Student.countDocuments({ school: school._id, status: "active" }),
            schoolYearForShifts
              ? Group.countDocuments({ school: school._id, school_year_id: schoolYearForShifts })
              : 0,
          ]);

        // Nombre del ciclo activo de la escuela
        let schoolCycleName = null;
        if (school.current_school_year_id) {
          const sy = await SchoolYear.findById(school.current_school_year_id)
            .select("name")
            .lean();
          schoolCycleName = sy?.name || null;
        }

        return {
          _id: school._id,
          name: school.name,
          cct: school.cct,
          honoraryName: school.honoraryName,
          logoUrl: school.logoUrl,
          isActive: school.isActive,
          currentSchoolYear: schoolCycleName,
          shifts: shiftNames,
          classDuration,
          staffCount,
          teachersCount,
          studentsCount,
          groupsCount,
        };
      })
    );

    res.status(200).json({
      schools: {
        total: totalSchools,
        active: activeSchools,
      },
      users: {
        total: totalUsers,
        thisMonth: usersThisMonth,
      },
      students: {
        active: totalStudents,
        schoolYear: schoolYearName,
      },
      schoolsList,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/dashboard/super-admin/schools/:schoolId/setup-status
// Devuelve qué piezas de configuración faltan para que el super_admin
// pueda hacer onboarding de una escuela. Auth: super_admin solamente.
//
// Cada "pieza" se evalúa contra el ciclo escolar ACTIVO de la escuela
// (School.current_school_year_id). Si no hay ciclo activo, todas las
// piezas relacionadas con el ciclo se marcan como pendientes.
const getSchoolSetupStatus = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    // Validar ObjectId
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ message: "Invalid schoolId." });
    }

    // Validar que la escuela existe. super_admin pasa school explícito
    // (no usamos tenantFilter aquí).
    const school = await School.findById(schoolId).select(
      "_id name cct current_school_year_id"
    );
    if (!school) {
      return res.status(404).json({ message: "School not found." });
    }

    const activeYearId = school.current_school_year_id;

    // Conteos en paralelo. Las piezas que dependen del ciclo activo
    // usan activeYearId como filtro (si no hay ciclo activo, todos
    // cuentan 0 y se marcan como pendientes).
    const [
      shiftsCount,
      groupsCount,
      teachersCount,
      subjectsCount,
      activeYearDoc,
      calendarDaysCount,
      schedulesCount,
    ] = await Promise.all([
      activeYearId
        ? SchoolShift.countDocuments({
            school: schoolId,
            school_year_id: activeYearId,
          })
        : Promise.resolve(0),
      activeYearId
        ? Group.countDocuments({
            school: schoolId,
            school_year_id: activeYearId,
          })
        : Promise.resolve(0),
      User.countDocuments({ school: schoolId, role: "teacher" }),
      Subject.countDocuments({ school: schoolId }),
      SchoolYear.findOne({ _id: activeYearId, school: schoolId, isActive: true })
        .select("_id name startDate endDate")
        .lean(),
      SchoolCalendar.countDocuments({
        school: schoolId,
        isActive: true,
      }),
      activeYearId
        ? ClassSchedule.countDocuments({
            school: schoolId,
            school_year_id: activeYearId,
          })
        : Promise.resolve(0),
    ]);

    const hasActiveYear = !!activeYearDoc;
    const hasShift = shiftsCount > 0;
    const hasCalendar = calendarDaysCount > 0;
    const hasSubjects = subjectsCount > 0;
    const hasTeachers = teachersCount > 0;
    const hasGroups = groupsCount > 0;
    const hasClassSchedules = schedulesCount > 0;

    // Lista ordenada de piezas faltantes (orden = orden sugerido de
    // configuración: ciclo → turnos → calendario → materias → maestros
    // → asignaciones → grupos → horarios).
    const missing = [];
    if (!hasActiveYear) missing.push("school_year");
    if (!hasShift) missing.push("shifts");
    if (!hasCalendar) missing.push("calendar");
    if (!hasSubjects) missing.push("subjects");
    if (!hasTeachers) missing.push("teachers");
    if (!hasGroups) missing.push("groups");
    if (!hasClassSchedules) missing.push("class_schedules");

    const totalSteps = 7;
    const completedSteps = totalSteps - missing.length;
    const percent = Math.round((completedSteps / totalSteps) * 100);

    res.status(200).json({
      schoolId: school._id,
      schoolName: school.name,
      schoolCct: school.cct,
      activeYear: activeYearDoc
        ? {
            _id: activeYearDoc._id,
            name: activeYearDoc.name,
            startDate: activeYearDoc.startDate,
            endDate: activeYearDoc.endDate,
          }
        : null,
      hasActiveYear,
      hasShift,
      hasCalendar,
      hasSubjects,
      hasTeachers,
      hasGroups,
      hasClassSchedules,
      counts: {
        shifts: shiftsCount,
        groups: groupsCount,
        teachers: teachersCount,
        subjects: subjectsCount,
        calendarDays: calendarDaysCount,
        classSchedules: schedulesCount,
      },
      progress: {
        completed: completedSteps,
        total: totalSteps,
        percent,
      },
      missing,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/dashboard/super-admin/schools/:schoolId/teachers
// Lista los maestros (User con role=teacher) de la escuela. Auth: super_admin.
// Opcionalmente se puede filtrar por yearId para incluir counts de
// TeacherSubject (asignaciones) y ClassSchedule (horas asignadas).
const getSchoolTeachers = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ message: "Invalid schoolId." });
    }

    const school = await School.findById(schoolId).select("_id").lean();
    if (!school) {
      return res.status(404).json({ message: "School not found." });
    }

    // Listado base: todos los users con role=teacher en esta escuela.
    const teachers = await User.find({
      school: schoolId,
      role: "teacher",
    })
      .select("_id name last_name email phoneNumber isActive sex academicPreparation")
      .sort({ last_name: 1, name: 1 })
      .lean();

    res.status(200).json({
      items: teachers,
      total: teachers.length,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/dashboard/super-admin/schools/:schoolId/groups
// Lista los grupos de la escuela, opcionalmente filtrados por yearId.
// Auth: super_admin.
const getSchoolGroups = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ message: "Invalid schoolId." });
    }

    const filter = { school: schoolId };
    if (
      req.query.yearId &&
      mongoose.Types.ObjectId.isValid(req.query.yearId)
    ) {
      filter.school_year_id = req.query.yearId;
    }

    const groups = await Group.find(filter)
      .select("_id grade section type shift school_year_id head_teacher_id")
      .sort({ grade: 1, section: 1 })
      .lean();

    res.status(200).json({
      items: groups,
      total: groups.length,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/dashboard/super-admin/schools/:schoolId/teacher-subjects
// Lista las asignaciones maestro-materia-grupo de la escuela (filtrable
// por yearId). Auth: super_admin.
const getSchoolTeacherSubjects = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ message: "Invalid schoolId." });
    }

    const filter = { school: schoolId };
    if (
      req.query.yearId &&
      mongoose.Types.ObjectId.isValid(req.query.yearId)
    ) {
      filter.school_year_id = req.query.yearId;
    }

    const assignments = await TeacherSubject.find(filter)
      .populate("teacher_id", "_id name last_name phoneNumber")
      .populate("subject_id", "_id code name color")
      .populate("group_id", "_id grade section")
      .sort({ "teacher_id.last_name": 1, "subject_id.code": 1 })
      .lean();

    res.status(200).json({
      items: assignments,
      total: assignments.length,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/dashboard/super-admin/pending-tasks
// Lista de "Tareas pendientes" para el super_admin: escuelas sin
// ciclo activo, sin turnos, sin calendario, sin materias, sin
// maestros, sin grupos, etc. Auth: super_admin.
const getPendingTasks = async (req, res, next) => {
  try {
    // Lista base de todas las escuelas (excluir super_admin usa school=null)
    const schools = await School.find()
      .select("_id name cct isActive current_school_year_id")
      .lean();

    const tasks = [];
    for (const school of schools) {
      const schoolId = school._id;
      // Resolver cycle activo
      let yearId = school.current_school_year_id;
      if (!yearId) {
        // buscar el más reciente activo
        const latest = await SchoolYear.findOne({
          school: schoolId,
        })
          .sort({ startDate: -1 })
          .select("_id")
          .lean();
        yearId = latest?._id || null;
      }

      // Conteos
      const [shifts, calendarDays, subjects, teachers, groups, schedules] =
        yearId
          ? await Promise.all([
              SchoolShift.countDocuments({ school: schoolId, school_year_id: yearId }),
              SchoolCalendar.countDocuments({ school: schoolId, is_active: true }),
              Subject.countDocuments({ school: schoolId }),
              User.countDocuments({ school: schoolId, role: "teacher" }),
              Group.countDocuments({ school: schoolId, school_year_id: yearId }),
              ClassSchedule.countDocuments({ school: schoolId, school_year_id: yearId }),
            ])
          : [0, 0, 0, 0, 0, 0];

      const issues = [];
      if (!school.isActive) issues.push({ kind: "school_inactive", message: "Escuela inactiva" });
      if (!yearId) issues.push({ kind: "no_active_cycle", message: "Sin ciclo escolar activo" });
      if (shifts === 0) issues.push({ kind: "no_shifts", message: "Sin turnos configurados" });
      if (calendarDays === 0) issues.push({ kind: "no_calendar", message: "Sin días en el calendario escolar" });
      if (subjects === 0) issues.push({ kind: "no_subjects", message: "Sin materias registradas" });
      if (teachers === 0) issues.push({ kind: "no_teachers", message: "Sin maestros registrados" });
      if (groups === 0) issues.push({ kind: "no_groups", message: "Sin grupos registrados" });
      if (schedules === 0) issues.push({ kind: "no_schedules", message: "Sin horarios de clase" });

      if (issues.length > 0) {
        tasks.push({
          school_id: schoolId,
          school_name: school.name,
          school_year_id: yearId,
          school_year_name: null,
          issues,
        });
      }
    }

    // Enriquecer con nombre del ciclo
    if (tasks.length > 0) {
      const yearIds = tasks
        .map((t) => t.school_year_id)
        .filter(Boolean);
      if (yearIds.length > 0) {
        const years = await SchoolYear.find({ _id: { $in: yearIds } })
          .select("_id name")
          .lean();
        const yearMap = new Map(years.map((y) => [String(y._id), y.name]));
        for (const t of tasks) {
          if (t.school_year_id) {
            t.school_year_name = yearMap.get(String(t.school_year_id)) || null;
          }
        }
      }
    }

    res.status(200).json({ tasks, total_schools: schools.length });
  } catch (error) {
    next(error);
  }
};

// PUT /api/dashboard/super-admin/schools/:schoolId/teachers/:teacherId
// Actualiza datos de un maestro (name, last_name, phoneNumber, email, sex,
// academicPreparation, isActive). Auth: super_admin.
const updateTeacher = async (req, res, next) => {
  try {
    const { schoolId, teacherId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId) || !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ message: "Invalid schoolId or teacherId." });
    }

    const school = await School.findById(schoolId).select("_id").lean();
    if (!school) {
      return res.status(404).json({ message: "School not found." });
    }

    const user = await User.findOne({ _id: teacherId, school: schoolId, role: "teacher" });
    if (!user) {
      return res.status(404).json({ message: "Teacher not found." });
    }

    const allowedFields = ["name", "last_name", "phoneNumber", "email", "sex", "academicPreparation", "isActive"];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields to update." });
    }

    const updated = await User.findOneAndUpdate(
      { _id: teacherId, school: schoolId },
      { $set: updates },
      { new: true, runValidators: true }
    ).select("_id name last_name email phoneNumber isActive sex academicPreparation");

    res.status(200).json({ teacher: updated });
  } catch (error) {
    next(error);
  }
};

// GET /api/dashboard/super-admin/schools/:schoolId/users
// Lista todos los usuarios de la escuela (admin, registrar, teacher, etc.).
const getSchoolUsers = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ message: "Invalid schoolId." });
    }

    const school = await School.findById(schoolId).select("_id").lean();
    if (!school) {
      return res.status(404).json({ message: "School not found." });
    }

    const users = await User.find({ school: schoolId })
      .select("_id name last_name email phoneNumber role isActive sex academicPreparation")
      .sort({ role: 1, name: 1 })
      .lean();

    res.status(200).json({ items: users });
  } catch (error) {
    next(error);
  }
};

// GET /api/dashboard/super-admin/schools/:schoolId/workshops
// Lista los talleres de la escuela: las ofertas de materias tipo WORKSHOP
// y los Groups(type:"taller") del ciclo activo (o filtrado por ?yearId=).
const getSchoolWorkshops = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ message: "Invalid schoolId." });
    }

    const school = await School.findById(schoolId).select("_id").lean();
    if (!school) {
      return res.status(404).json({ message: "School not found." });
    }

    // 1) Ofertas de talleres definidas en las materias
    const workshopSubjects = await Subject.find({
      school: schoolId,
      classificationType: "WORKSHOP",
      "workshops.0": { $exists: true },
    })
      .select("name code color icon workshops")
      .lean();

    // 2) Groups(type:"taller") del ciclo (activo por defecto, o filtrado por yearId)
    let yearFilter = {};
    if (req.query.yearId) {
      yearFilter = { school_year_id: req.query.yearId };
    } else {
      const activeYear = await SchoolYear.findOne({ school: schoolId, isActive: true })
        .select("_id")
        .lean();
      if (activeYear) {
        yearFilter = { school_year_id: activeYear._id };
      }
    }

    const tallerGroups = await Group.find({
      school: schoolId,
      type: "taller",
      ...yearFilter,
    })
      .select("grade section shift head_teacher_id school_year_id")
      .populate("head_teacher_id", "name last_name")
      .lean();

    // 3) Conteo de alumnos por taller
    const Student = require("../models/Student.model");
    const tallerIds = tallerGroups.map((g) => g._id);
    const studentCounts = await Student.aggregate([
      { $match: { workshop_group_id: { $in: tallerIds }, school: mongoose.Types.ObjectId(schoolId) } },
      { $group: { _id: "$workshop_group_id", count: { $sum: 1 } } },
    ]);
    const countMap = {};
    for (const sc of studentCounts) {
      countMap[sc._id.toString()] = sc.count;
    }

    const groupsWithCount = tallerGroups.map((g) => ({
      ...g,
      studentCount: countMap[g._id.toString()] || 0,
    }));

    res.status(200).json({
      offerings: workshopSubjects,
      groups: groupsWithCount,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/dashboard/super-admin/schools/:schoolId/users/:userId
// Actualiza un usuario staff (cualquier rol excepto super_admin y tutor).
const updateStaffUser = async (req, res, next) => {
  try {
    const { schoolId, userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid schoolId or userId." });
    }

    const school = await School.findById(schoolId).select("_id").lean();
    if (!school) {
      return res.status(404).json({ message: "School not found." });
    }

    const user = await User.findOne({ _id: userId, school: schoolId });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (user.role === "super_admin" || user.role === "tutor") {
      return res.status(403).json({ message: "Cannot update this user type." });
    }

    const allowedFields = ["name", "last_name", "phoneNumber", "email", "sex", "role", "isActive", "academicPreparation"];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields to update." });
    }

    const updated = await User.findOneAndUpdate(
      { _id: userId, school: schoolId },
      { $set: updates },
      { new: true, runValidators: true }
    ).select("_id name last_name email phoneNumber role isActive sex academicPreparation");

    res.status(200).json({ user: updated });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSuperAdminDashboard,
  getSchoolSetupStatus,
  getSchoolTeachers,
  getSchoolGroups,
  getSchoolTeacherSubjects,
  getSchoolUsers,
  getSchoolWorkshops,
  getPendingTasks,
  updateTeacher,
  updateStaffUser,
};
