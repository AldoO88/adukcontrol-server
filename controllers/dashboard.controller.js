// Controlador del Dashboard Super Admin
// Proporciona estadísticas agregadas para el panel principal.
const School = require("../models/School.model");
const User = require("../models/User.model");
const Student = require("../models/Student.model");
const SchoolYear = require("../models/SchoolYear.model");
const SchoolShift = require("../models/SchoolShift.model");
const Group = require("../models/Group.model");

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

module.exports = {
  getSuperAdminDashboard,
};
