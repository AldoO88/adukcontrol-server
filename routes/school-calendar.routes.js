// Router de Calendario Escolar (SchoolCalendar)
// Endpoints bajo /api/school-calendar. Todos requieren JWT.
// Escritura: admin/registrar/super_admin. Lectura: cualquier rol staff.
const express = require("express");
const {
  getSchoolCalendarController,
  createSchoolCalendarController,
  updateSchoolCalendarController,
  deleteSchoolCalendarController,
  bulkMarkWeekends,
} = require("../controllers/school-calendar.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");

const { Router } = express;
const router = Router();

const readRoles = [
  "admin",
  "principal",
  "registrar",
  "teacher",
  "super_admin",
];
const writeRoles = ["admin", "registrar", "super_admin"];

// GET /api/school-calendar — listar registros
router.get("/", isAuthenticated, authorize(...readRoles), getSchoolCalendarController);

// POST /api/school-calendar — crear un registro
router.post("/", isAuthenticated, authorize(...writeRoles), createSchoolCalendarController);

// POST /api/school-calendar/weekends — bulk-markear días no lectivos
// Body: { school_year_id, weekdays: [0..6] }
router.post("/weekends", isAuthenticated, authorize(...writeRoles), bulkMarkWeekends);

// PUT /api/school-calendar/:entryId — actualizar
router.put("/:entryId", isAuthenticated, authorize(...writeRoles), updateSchoolCalendarController);

// DELETE /api/school-calendar/:entryId — eliminar (soft)
router.delete("/:entryId", isAuthenticated, authorize(...writeRoles), deleteSchoolCalendarController);

module.exports = router;
