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
  updateStaffUser,
} = require("../controllers/dashboard.controller");
const { createGroup, updateGroup, deleteGroup } = require("../controllers/groups.controller");
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

// POST /api/dashboard/super-admin/schools/:schoolId/groups — crear grupo
router.post("/super-admin/schools/:schoolId/groups", (req, res, next) => {
  req.body.school = req.params.schoolId;
  createGroup(req, res, next);
});

// PUT /api/dashboard/super-admin/schools/:schoolId/groups/:groupId — actualizar grupo
router.put("/super-admin/schools/:schoolId/groups/:groupId", (req, res, next) => {
  updateGroup(req, res, next);
});

// DELETE /api/dashboard/super-admin/schools/:schoolId/groups/:groupId — eliminar grupo
router.delete("/super-admin/schools/:schoolId/groups/:groupId", (req, res, next) => {
  deleteGroup(req, res, next);
});

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

// PUT /api/dashboard/super-admin/schools/:schoolId/users/:userId — actualizar usuario staff
router.put("/super-admin/schools/:schoolId/users/:userId", updateStaffUser);

module.exports = router;
