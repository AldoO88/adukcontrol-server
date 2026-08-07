// Controlador de ConductLog
// CRUD sobre el ledger de eventos de conducta de los estudiantes.
// Cada evento puede ser de tipo "demerit" (resta puntos) o "merit"
// (suma puntos y permite recuperar score).
//
// Multi-tenant estricto: cada query filtra por la escuela del usuario.
// Al crear/cancelar un evento, invalida el cache de dashboard de los
// tutores del estudiante (afecta el KPI "conduct_score" del dashboard).
const mongoose = require("mongoose");
const ConductLog = require("../models/ConductLog.model");
const Student = require("../models/Student.model");
const SchoolYear = require("../models/SchoolYear.model");
const {
  getConductConfig,
  getImpactForEvent,
} = require("../services/conduct.service");
const {
  invalidateStudentDashboardCache,
} = require("../services/dashboard-cache.service");
const { getConductKpi } = require("../services/student-kpi.service");

// Helper: filtro de tenant según el role del usuario
const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

// Roles que pueden registrar eventos de conducta
const REPORTER_ROLES = [
  "admin",
  "principal",
  "registrar",
  "teacher",
  "prefect",
  "social_worker",
  "super_admin",
];

// Roles que pueden cancelar (soft-cancel) eventos
const CANCEL_ROLES = ["admin", "principal", "registrar", "super_admin"];

// POST /api/conduct-logs
// Crea un evento de conducta. El `points_impact` se resuelve desde la
// ConductConfig de la escuela en el momento de la creación:
//   - demerit → config.weights[severity] (o el override en el body)
//   - merit   → config.merit_points     (o el override en el body)
// Se copia al doc (NO se recalcula contra cambios futuros en la config).
// Body:
//   { student_id, school_year_id, eventType, severity?, points_impact_override?,
//     description?, incident_date? }
const createLog = async (req, res, next) => {
  try {
    const {
      student_id,
      school_year_id,
      eventType,
      severity,
      points_impact_override,
      description,
      details,
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
    if (!["demerit", "merit"].includes(eventType)) {
      return res
        .status(400)
        .json({ message: 'eventType must be: "demerit" or "merit".' });
    }

    // severity solo aplica a demerits
    if (eventType === "demerit") {
      if (!["minor", "moderate", "severe"].includes(severity)) {
        return res.status(400).json({
          message:
            "severity is required for demerits (must be: minor, moderate or severe).",
        });
      }
    }

    // override opcional: validar tipo y signo si viene
    if (points_impact_override !== undefined && points_impact_override !== null) {
      if (typeof points_impact_override !== "number" || points_impact_override < 0) {
        return res.status(400).json({
          message: "points_impact_override must be a non-negative number.",
        });
      }
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

    // Resolver el impacto desde la ConductConfig actual
    const config = await getConductConfig(student.school);
    const impact = getImpactForEvent(
      eventType,
      severity,
      config,
      points_impact_override
    );

    const log = await ConductLog.create({
      school: student.school,
      student_id: student._id,
      school_year_id: year._id,
      eventType,
      severity: eventType === "demerit" ? severity : null,
      points_impact: impact,
      description: description ? String(description).trim() : null,
      details: details ? String(details).trim() : null,
      incident_date: incident_date ? new Date(incident_date) : new Date(),
      reported_by: req.payload._id,
      status: "active",
    });

    // Invalidar cache del dashboard de los tutores de este student
    await invalidateStudentDashboardCache(student._id);

    // Devolver con populate del reporter, student y año
    const populated = await ConductLog.findById(log._id)
      .populate("reported_by", "name email role")
      .populate("student_id", "controlNumber first_name last_name")
      .populate("school_year_id", "name startDate endDate isActive");

    res.status(201).json(populated);
  } catch (error) {
    next(error);
  }
};

// GET /api/conduct-logs
// Lista eventos con filtros. Staff únicamente.
const getAllLogs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      student_id,
      school_year_id,
      eventType,
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
    if (eventType) filter.eventType = eventType;
    if (severity) filter.severity = severity;
    if (status) filter.status = status;
    if (from || to) {
      filter.incident_date = {};
      if (from) filter.incident_date.$gte = new Date(from);
      if (to) filter.incident_date.$lte = new Date(to);
    }

    const skip = (pageNum - 1) * limitNum;
    const [items, total] = await Promise.all([
      ConductLog.find(filter)
        .populate("reported_by", "name email role")
        .populate("student_id", "controlNumber first_name last_name")
        .populate("school_year_id", "name startDate endDate isActive")
        .sort({ incident_date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      ConductLog.countDocuments(filter),
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

// GET /api/conduct-logs/:logId
const getLogById = async (req, res, next) => {
  try {
    const { logId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(logId)) {
      return res.status(404).json({ message: `No log with id: ${logId}` });
    }
    const log = await ConductLog.findOne({
      _id: logId,
      ...tenantFilter(req),
    })
      .populate("reported_by", "name email role")
      .populate("student_id", "controlNumber first_name last_name")
      .populate("school_year_id", "name startDate endDate isActive");
    if (!log) {
      return res.status(404).json({ message: `No log with id: ${logId}` });
    }
    res.status(200).json(log);
  } catch (error) {
    next(error);
  }
};

// PUT /api/conduct-logs/:logId/cancel
// Soft-cancel: cambia status a "cancelled". NO elimina el documento
// (auditoría). El KPI deja de contarlo.
const cancelLog = async (req, res, next) => {
  try {
    const { logId } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(logId)) {
      return res.status(404).json({ message: `No log with id: ${logId}` });
    }

    const log = await ConductLog.findOne({
      _id: logId,
      ...tenantFilter(req),
    });
    if (!log) {
      return res.status(404).json({ message: `No log with id: ${logId}` });
    }
    if (log.status === "cancelled") {
      return res
        .status(400)
        .json({ message: "Log is already cancelled." });
    }

    log.status = "cancelled";
    // Guardamos el motivo prefijado en la descripción (sin pisar la original)
    if (reason && String(reason).trim()) {
      const original = log.description || "";
      const cancelTag = `[CANCELADO: ${String(reason).trim()}]`;
      log.description = original ? `${cancelTag} ${original}` : cancelTag;
    }
    await log.save();

    // Invalidar cache: el score cambia
    await invalidateStudentDashboardCache(log.student_id);

    const populated = await ConductLog.findById(log._id)
      .populate("reported_by", "name email role")
      .populate("student_id", "controlNumber first_name last_name")
      .populate("school_year_id", "name startDate endDate isActive");

    res.status(200).json({
      message: "Conduct log cancelled successfully.",
      log: populated,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/conduct-logs/:logId
// Borrado físico. Solo super_admin (auditoría). NO se usa en el flujo
// normal; el flujo correcto es cancelLog (soft).
const deleteLog = async (req, res, next) => {
  try {
    const { logId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(logId)) {
      return res.status(404).json({ message: `No log with id: ${logId}` });
    }
    const deleted = await ConductLog.findOneAndDelete({
      _id: logId,
      ...tenantFilter(req),
    });
    if (!deleted) {
      return res.status(404).json({ message: `No log with id: ${logId}` });
    }
    await invalidateStudentDashboardCache(deleted.student_id);
    res.status(200).json({ message: "Conduct log deleted successfully." });
  } catch (error) {
    next(error);
  }
};

// GET /api/guardians/me/students/:studentId/conduct-logs
// Vista del tutor: el ledger de eventos de SU hijo. Solo los activos
// por default. Por defecto mezcla merits y demerits (ordenados por fecha).
//
// Pre-requisitos (manejados por middlewares previos del router):
//   - attachSchoolContext       → req.school
//   - attachActiveSchoolYear    → req.schoolYear
//   - requireGuardianOf         → valida que el caller es tutor del student
const getMyStudentLogs = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { school_year_id, eventType, include_cancelled } = req.query;

    // Seguridad: garantizada por los middlewares previos. No validamos nada acá.
    const filter = {
      student_id: studentId,
      school: req.school, // multi-tenant
    };
    if (school_year_id && mongoose.Types.ObjectId.isValid(school_year_id)) {
      filter.school_year_id = school_year_id;
    }
    if (eventType) filter.eventType = eventType;
    // Por default NO mostramos los cancelados al tutor
    if (include_cancelled !== "true") {
      filter.status = "active";
    }

    const logs = await ConductLog.find(filter)
      .populate("reported_by", "name role")
      .populate("school_year_id", "name startDate endDate isActive")
      .sort({ incident_date: -1, createdAt: -1 });

    // Sanitizamos la descripción de los cancelados (puede contener el
    // motivo interno, que no es del tutor)
    const items = logs.map((l) => {
      const obj = l.toObject();
      if (obj.status === "cancelled" && obj.description) {
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

// GET /api/guardians/me/students/:studentId/conduct-summary
// Resumen de conducta del estudiante para el Guardian Dashboard cuando
// el padre selecciona un hijo específico.
//
// Pre-requisitos (manejados por los middlewares previos del router):
//   - isAuthenticated           → req.payload con schoolId
//   - attachSchoolContext       → req.school
//   - attachActiveSchoolYear    → req.schoolYear
//   - requireGuardianOf         → valida que el caller es tutor del student
//
// Cálculo del score (delegado a services/student-kpi.service.js):
//   - baseline + (sum(merits) - sum(demerits)) sobre TODA la historia
//   - Clamp [0, baseline]
//   - recentLogs: eventos ACTIVOS del ciclo activo, ordenados por fecha desc
const getStudentConductSummary = async (req, res, next) => {
  try {
    // El controller NO valida nada de seguridad/contexto: confía en los
    // middlewares previos. Solo se dedica a la lógica de negocio.
    const kpi = await getConductKpi(
      req.params.studentId,
      req.schoolYear,
      req.school
    );

    // Mapeo al shape pedido por el front del Guardian Dashboard.
    // `baseline` del service → `maxScore` del UI (el score nunca lo supera).
    res.status(200).json({
      success: true,
      data: {
        currentScore: kpi.currentScore,
        maxScore: kpi.baseline,
        recentLogs: kpi.currentYearLogs,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createLog,
  getAllLogs,
  getLogById,
  cancelLog,
  deleteLog,
  getMyStudentLogs,
  getStudentConductSummary,
  // Roles exportados para usar desde las rutas
  REPORTER_ROLES,
  CANCEL_ROLES,
};
