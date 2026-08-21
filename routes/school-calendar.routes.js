// Router de Calendario Escolar (SchoolCalendar)
// Endpoints bajo /api/school-calendar.
const express = require("express");
const {
  getSchoolCalendarController,
  createSchoolCalendarController,
  updateSchoolCalendarController,
  deleteSchoolCalendarController,
} = require("../controllers/school-calendar.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const { Router } = express;
const router = Router();

// GET /api/school-calendar
// Lista registros del calendario. Auth: JWT + staff.
router.get(
  "/",
  isAuthenticated,
  authorize("admin", "principal", "registrar", "teacher", "super_admin"),
  getSchoolCalendarController
);

// POST /api/school-calendar
// Crea un registro. Auth: JWT + admin/registrar/super_admin.
router.post(
  "/",
  isAuthenticated,
  authorize("admin", "registrar", "super_admin"),
  createSchoolCalendarController
);

// PUT /api/school-calendar/:entryId
// Actualiza un registro. Auth: JWT + admin/registrar/super_admin.
router.put(
  "/:entryId",
  isAuthenticated,
  authorize("admin", "registrar", "super_admin"),
  updateSchoolCalendarController
);

// DELETE /api/school-calendar/:entryId
// Elimina (soft delete) un registro. Auth: JWT + admin/registrar/super_admin.
router.delete(
  "/:entryId",
  isAuthenticated,
  authorize("admin", "registrar", "super_admin"),
  deleteSchoolCalendarController
);

module.exports = router;
