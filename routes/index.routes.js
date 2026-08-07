// Router principal de /api
// Agrupa los sub-routers de cada recurso bajo un prefijo común.
const express = require("express");
const router = express.Router();

const schoolsRouter = require("./schools.routes"); // /api/schools (solo super_admin)
const schoolYearsRouter = require("./school-years.routes"); // /api/school-years (ciclos escolares)
const studentsRouter = require("./students.routes"); // /api/students
const attendanceRouter = require("./attendance.routes"); // /api/attendance
const groupsRouter = require("./groups.routes"); // /api/groups
const enrollmentsRouter = require("./enrollments.routes"); // /api/enrollments
const guardiansRouter = require("./guardians.routes"); // /api/guardians
const webhooksRouter = require("./webhooks.routes"); // /api/webhooks (Cloudinary)
const uploadsRouter = require("./uploads.routes"); // /api/uploads (SSE + manual retry)
const subjectsRouter = require("./subjects.routes"); // /api/subjects (catálogo de materias)
const teacherSubjectsRouter = require("./teacher-subjects.routes"); // /api/teacher-subjects (asignaciones)
const { studentOnlyGrades, gradeById } = require("./grades.routes"); // calificaciones
const conductLogsRouter = require("./conduct-logs.routes"); // /api/conduct-logs (ledger de conducta: demerits + merits)
const conductConfigRouter = require("./conduct-config.routes"); // /api/conduct-config (config de impacto)
const announcementsRouter = require("./announcements.routes"); // /api/announcements (CRUD staff de avisos)
const citationsRouter = require("./citations.routes"); // /api/citations (CRUD staff de citatorios)

// Health check rápido bajo /api
router.get("/", (req, res, next) => {
  res.json({ message: "Eduk Control API — all good in here" });
});

router.use("/schools", schoolsRouter);
router.use("/school-years", schoolYearsRouter);
router.use("/students", studentsRouter);
router.use("/attendance", attendanceRouter);
router.use("/groups", groupsRouter);
router.use("/enrollments", enrollmentsRouter);
router.use("/guardians", guardiansRouter);
router.use("/webhooks", webhooksRouter);
router.use("/uploads", uploadsRouter);
router.use("/subjects", subjectsRouter);
router.use("/teacher-subjects", teacherSubjectsRouter);
router.use("/conduct-logs", conductLogsRouter);
router.use("/conduct-config", conductConfigRouter);
router.use("/announcements", announcementsRouter);
router.use("/citations", citationsRouter);
// Calificaciones: rutas anidadas bajo students + rutas planas en /grades
router.use("/students/:studentId/grades", studentOnlyGrades);
router.use("/grades", gradeById);

module.exports = router;
