// Controlador de Reportes Disciplinarios
// CRUD sobre los reportes de conducta de los estudiantes.
// Multi-tenant estricto: cada query filtra por la escuela del usuario.
// Al crear/cancelar un reporte, invalida el cache de dashboard de los
// tutores del estudiante (afecta el KPI "conduct_score" del dashboard).
const mongoose = require("mongoose");
const DisciplinaryReport = require("../models/DisciplinaryReport.model");
const Student = require("../models/Student.model");
const SchoolYear = require("../models/SchoolYear.model");
const Guardian = require("../models/Guardian.model");
const {
  getConductConfig,
  getDeductionForSeverity,
} = require("../services/conduct.service");
const {
  invalidateStudentDashboardCache,
} = require("../services/dashboard-cache.service");

// Helper: filtro de tenant según el role del usuario
const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

// Roles que pueden crear reportes (staff con trato directo con alumnos)
const REPORTER_ROLES = [
  "admin",
  "principal",
  "registrar",
  "teacher",
  "prefect",
  "social_worker",
  "super_admin",
];

// Roles que pueden cancelar reportes (solo dirección / control escolar)
const CANCEL_ROLES = ["admin", "principal", "registrar", "super_admin"];

// POST /api/disciplinary-reports
// Crea un reporte. El `points_deduction` se copia de la ConductConfig
// vigente en el momento de la creación (no se recalcula si la config cambia).
// Body: { student_id, school_year_id, severity, description?, incident_date? }
const createReport = async (req, res, next) => {
  try {
    const {
      student_id,
      school_year_id,
      severity,
      description,
      incident_date,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(student_id)) {
      return res
        .status(400)
        .json({ message: "Valid student_id is required." });
    }
    if (!mongoose.Types.ObjectId.isValid(school_year_id)) {
      return res
        .status(400)
        .json({ message: "Valid school_year_id is required." });
    }
    if (!["minor", "moderate", "severe"].includes(severity)) {
      return res
        .status(400)
        .json({ message: "severity must be: minor, moderate or severe." });
    }

    // Verificar que el student existe y pertenece al tenant
    const student = await Student.findOne({
      _id: student_id,
      ...tenantFilter(req),
    })
      .select("_id school")
      .lean();
    if (!student) {
      return res
        .status(404)
        .json({ message: "Student not found in this tenant." });
    }

    // Verificar que el ciclo existe y pertenece a la misma escuela del student
    const year = await SchoolYear.findOne({
      _id: school_year_id,
      school: student.school,
    })
      .select("_id school name startDate endDate isActive")
      .lean();
    if (!year) {
      return res.status(404).json({
        message: "School year not found for this student's school.",
      });
    }

    // Resolver el descuento según la ConductConfig actual de la escuela
    const config = await getConductConfig(student.school);
    const deduction = getDeductionForSeverity(severity, config);

    const report = await DisciplinaryReport.create({
      school: student.school,
      student_id: student._id,
      school_year_id: year._id,
      severity,
      points_deduction: deduction,
      description: description ? String(description).trim() : null,
      incident_date: incident_date ? new Date(incident_date) : new Date(),
      reported_by: req.payload._id,
      status: "active",
    });

    // Invalidar cache del dashboard de los tutores de este student
    await invalidateStudentDashboardCache(student._id);

    // Devolver con populate del reporter y del student
    const populated = await DisciplinaryReport.findById(report._id)
      .populate("reported_by", "name email role")
      .populate("student_id", "enrollment_number first_name last_name")
      .populate("school_year_id", "name startDate endDate isActive");

    res.status(201).json(populated);
  } catch (error) {
    next(error);
  }
};

// GET /api/disciplinary-reports
// Lista reportes con filtros. Staff únicamente.
const getAllReports = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      student_id,
      school_year_id,
      severity,
      status,
      from,
      to,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = { ...tenantFilter(req) };
    if (student_id && mongoose.Types.ObjectId.isValid(student_id)) {
      filter.student_id = student_id;
    }
    if (school_year_id && mongoose.Types.ObjectId.isValid(school_year_id)) {
      filter.school_year_id = school_year_id;
    }
    if (severity) filter.severity = severity;
    if (status) filter.status = status;
    if (from || to) {
      filter.incident_date = {};
      if (from) filter.incident_date.$gte = new Date(from);
      if (to) filter.incident_date.$lte = new Date(to);
    }

    const skip = (pageNum - 1) * limitNum;
    const [items, total] = await Promise.all([
      DisciplinaryReport.find(filter)
        .populate("reported_by", "name email role")
        .populate("student_id", "enrollment_number first_name last_name")
        .populate("school_year_id", "name startDate endDate isActive")
        .sort({ incident_date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      DisciplinaryReport.countDocuments(filter),
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

// GET /api/disciplinary-reports/:reportId
const getReportById = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return res
        .status(404)
        .json({ message: `No report with id: ${reportId}` });
    }
    const report = await DisciplinaryReport.findOne({
      _id: reportId,
      ...tenantFilter(req),
    })
      .populate("reported_by", "name email role")
      .populate("student_id", "enrollment_number first_name last_name")
      .populate("school_year_id", "name startDate endDate isActive");
    if (!report) {
      return res
        .status(404)
        .json({ message: `No report with id: ${reportId}` });
    }
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
};

// PUT /api/disciplinary-reports/:reportId/cancel
// Soft-cancel: cambia status a "cancelled". NO elimina el documento
// (necesitamos el historial para auditorías). El KPI deja de contarlo.
const cancelReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return res
        .status(404)
        .json({ message: `No report with id: ${reportId}` });
    }

    const report = await DisciplinaryReport.findOne({
      _id: reportId,
      ...tenantFilter(req),
    });
    if (!report) {
      return res
        .status(404)
        .json({ message: `No report with id: ${reportId}` });
    }
    if (report.status === "cancelled") {
      return res
        .status(400)
        .json({ message: "Report is already cancelled." });
    }

    report.status = "cancelled";
    // Guardamos el motivo en la descripción (sin pisar la original):
    // prefijo "[CANCELADO: <razón>] " si se proporcionó.
    if (reason && String(reason).trim()) {
      const original = report.description || "";
      const cancelTag = `[CANCELADO: ${String(reason).trim()}]`;
      report.description = original
        ? `${cancelTag} ${original}`
        : cancelTag;
    }
    await report.save();

    // Invalidar cache: el score cambia al descontar este reporte
    await invalidateStudentDashboardCache(report.student_id);

    const populated = await DisciplinaryReport.findById(report._id)
      .populate("reported_by", "name email role")
      .populate("student_id", "enrollment_number first_name last_name")
      .populate("school_year_id", "name startDate endDate isActive");

    res.status(200).json({
      message: "Report cancelled successfully.",
      report: populated,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/disciplinary-reports/:reportId
// Borrado físico. Solo super_admin (auditoría). NO se usa en el flujo normal;
// el flujo correcto es cancelReport (soft).
const deleteReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return res
        .status(404)
        .json({ message: `No report with id: ${reportId}` });
    }
    const deleted = await DisciplinaryReport.findOneAndDelete({
      _id: reportId,
      ...tenantFilter(req),
    });
    if (!deleted) {
      return res
        .status(404)
        .json({ message: `No report with id: ${reportId}` });
    }
    await invalidateStudentDashboardCache(deleted.student_id);
    res.status(200).json({ message: "Report deleted successfully." });
  } catch (error) {
    next(error);
  }
};

// GET /api/guardians/me/students/:studentId/disciplinary-reports
// Vista del tutor: reportes de SU hijo. Solo los activos por default.
// Auth: el caller debe ser Guardian del student.
const getMyStudentReports = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { school_year_id, include_cancelled } = req.query;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res
        .status(404)
        .json({ message: `No student with id: ${studentId}` });
    }

    // Validar que el caller es Guardian del student
    const isGuardian = await Guardian.findOne({
      user_id: req.payload._id,
      students: studentId,
      ...tenantFilter(req),
    }).lean();
    if (!isGuardian) {
      return res.status(403).json({
        message: "You are not a guardian of this student.",
      });
    }

    const filter = {
      student_id: studentId,
      ...tenantFilter(req),
    };
    if (school_year_id && mongoose.Types.ObjectId.isValid(school_year_id)) {
      filter.school_year_id = school_year_id;
    }
    // Por default NO mostramos los cancelados al tutor
    if (include_cancelled !== "true") {
      filter.status = "active";
    }

    const reports = await DisciplinaryReport.find(filter)
      .populate("reported_by", "name role")
      .populate("school_year_id", "name startDate endDate isActive")
      .sort({ incident_date: -1, createdAt: -1 });

    // Sanitizamos la descripción de los cancelados (puede contener el motivo
    // interno, que no es del tutor)
    const items = reports.map((r) => {
      const obj = r.toObject();
      if (obj.status === "cancelled" && obj.description) {
        // Quitamos el tag interno de cancelación del string visible al tutor
        obj.description = obj.description.replace(
          /^\[CANCELADO:[^\]]*\]\s*/,
          ""
        );
      }
      return obj;
    });

    res.status(200).json({
      student_id: studentId,
      items,
      total: items.length,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createReport,
  getAllReports,
  getReportById,
  cancelReport,
  deleteReport,
  getMyStudentReports,
  // exportados para uso desde las rutas (authorize)
  REPORTER_ROLES,
  CANCEL_ROLES,
};
