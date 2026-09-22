// Router del Dashboard Super Admin
// Endpoints bajo /api/dashboard. Solo accesible para super_admin.
const express = require("express");
const {
  getSuperAdminDashboard,
  getSchoolSetupStatus,
  getSchoolTeachers,
  getSchoolGroups,
  getSchoolTeacherSubjects,
  getSchoolUsers,
  getSchoolWorkshops,
  getPendingTasks,
  updateTeacher,
} = require("../controllers/dashboard.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);
router.use(authorize("super_admin"));

// GET /api/dashboard/super-admin — stats globales
router.get("/super-admin", getSuperAdminDashboard);

// GET /api/dashboard/super-admin/schools/:schoolId/setup-status — wizard de configuración
router.get("/super-admin/schools/:schoolId/setup-status", getSchoolSetupStatus);

// GET /api/dashboard/super-admin/schools/:schoolId/teachers — maestros de la escuela
router.get("/super-admin/schools/:schoolId/teachers", getSchoolTeachers);

// GET /api/dashboard/super-admin/schools/:schoolId/groups — grupos de la escuela
router.get("/super-admin/schools/:schoolId/groups", getSchoolGroups);

// GET /api/dashboard/super-admin/schools/:schoolId/teacher-subjects — asignaciones
router.get("/super-admin/schools/:schoolId/teacher-subjects", getSchoolTeacherSubjects);

// GET /api/dashboard/super-admin/schools/:schoolId/users — todos los usuarios de la escuela
router.get("/super-admin/schools/:schoolId/users", getSchoolUsers);

// GET /api/dashboard/super-admin/schools/:schoolId/workshops — talleres de la escuela
router.get("/super-admin/schools/:schoolId/workshops", getSchoolWorkshops);

// GET /api/dashboard/super-admin/pending-tasks — lista de tareas pendientes
router.get("/super-admin/pending-tasks", getPendingTasks);

// PUT /api/dashboard/super-admin/schools/:schoolId/teachers/:teacherId — actualizar maestro
router.put("/super-admin/schools/:schoolId/teachers/:teacherId", updateTeacher);

module.exports = router;
