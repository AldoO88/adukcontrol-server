// Router principal de /api
// Agrupa los sub-routers de cada recurso bajo un prefijo común.
const express = require("express");
const router = express.Router();

const schoolsRouter = require("./schools.routes"); // /api/schools (solo super_admin)
const studentsRouter = require("./students.routes"); // /api/students
const attendanceRouter = require("./attendance.routes"); // /api/attendance
const groupsRouter = require("./groups.routes"); // /api/groups
const enrollmentsRouter = require("./enrollments.routes"); // /api/enrollments
const tutorsRouter = require("./tutors.routes"); // /api/tutors

// Health check rápido bajo /api
router.get("/", (req, res, next) => {
  res.json({ message: "Eduk Control API — all good in here" });
});

router.use("/schools", schoolsRouter);
router.use("/students", studentsRouter);
router.use("/attendance", attendanceRouter);
router.use("/groups", groupsRouter);
router.use("/enrollments", enrollmentsRouter);
router.use("/tutors", tutorsRouter);

module.exports = router;
