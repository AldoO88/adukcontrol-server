// =====================================================================
// controllers/exit-pass.controller.js
// ---------------------------------------------------------------------
// CRUD de Pases de Salida (Exit Pass). Solo staff (prefect, admin, etc.)
// puede crear y consultar. El pase es un registro — no afecta el flujo
// de asistencia biométrica.
// =====================================================================

const mongoose = require("mongoose");
const ExitPass = require("../models/ExitPass.model");
const Student = require("../models/Student.model");
const SchoolYear = require("../models/SchoolYear.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

// Resuelve el ciclo escolar activo de la escuela del usuario.
const resolveActiveSchoolYear = async (schoolId) => {
  if (!schoolId) return null;
  const School = require("../models/School.model");
  const school = await School.findById(schoolId)
    .select("current_school_year_id")
    .lean();
  if (!school || !school.current_school_year_id) return null;
  return String(school.current_school_year_id);
};

// ------------------------------------------------------------------
// POST /api/exit-passes
// Crear un pase de salida. Valida que el alumno pertenezca a la escuela.
// ------------------------------------------------------------------
const createExitPass = async (req, res, next) => {
  try {
    const { student_id, guardian_name, relationship, reason, reason_detail } =
      req.body;

    // --- Validaciones de campos obligatorios ---
    if (!student_id || !mongoose.Types.ObjectId.isValid(student_id)) {
      return res
        .status(400)
        .json({ message: "student_id is required and must be valid." });
    }
    if (!guardian_name || !guardian_name.trim()) {
      return res
        .status(400)
        .json({ message: "guardian_name is required." });
    }
    if (
      !relationship ||
      !["father", "mother", "guardian", "family"].includes(relationship)
    ) {
      return res.status(400).json({
        message: "relationship must be: father, mother, guardian or family.",
      });
    }
    if (
      !reason ||
      !["illness", "medical", "family", "personal", "other"].includes(reason)
    ) {
      return res.status(400).json({
        message:
          "reason must be: illness, medical, family, personal or other.",
      });
    }

    // --- Buscar alumno (debe pertenecer a la misma escuela) ---
    const student = await Student.findOne({
      _id: student_id,
      status: "active",
      ...tenantFilter(req),
    })
      .select("_id school current_group_id first_name last_name")
      .lean();

    if (!student) {
      return res.status(404).json({
        message: `No active student with id '${student_id}' in your school.`,
      });
    }

    // --- Resolver ciclo escolar activo ---
    const schoolYearId = await resolveActiveSchoolYear(student.school);
    if (!schoolYearId) {
      return res
        .status(409)
        .json({ message: "No active school year configured." });
    }

    // --- Crear el pase de salida ---
    const exitPass = await ExitPass.create({
      school: student.school,
      school_year_id: schoolYearId,
      student_id: student._id,
      group_id: student.current_group_id,
      guardian_name: guardian_name.trim(),
      relationship,
      reason,
      reason_detail: reason_detail?.trim() || null,
      exit_time: new Date(),
      created_by: req.payload._id,
    });

    // --- Poblar para la respuesta ---
    const populated = await ExitPass.findById(exitPass._id)
      .populate("student_id", "first_name last_name controlNumber")
      .populate("group_id", "grade section")
      .populate("created_by", "name last_name")
      .lean();

    return res.status(201).json({
      success: true,
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// ------------------------------------------------------------------
// GET /api/exit-passes
// Lista paginada de pases de salida. Filtros: student_id, from, to.
// ------------------------------------------------------------------
const listExitPasses = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, student_id, from, to } = req.query;

    const filter = { ...tenantFilter(req), status: "active" };

    if (student_id && mongoose.Types.ObjectId.isValid(student_id)) {
      filter.student_id = student_id;
    }

    if (from || to) {
      filter.exit_time = {};
      if (from) filter.exit_time.$gte = new Date(from);
      if (to) filter.exit_time.$lte = new Date(to);
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      ExitPass.find(filter)
        .populate("student_id", "first_name last_name controlNumber")
        .populate("group_id", "grade section")
        .populate("created_by", "name last_name")
        .sort({ exit_time: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ExitPass.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ------------------------------------------------------------------
// GET /api/exit-passes/:id
// Detalle de un pase de salida.
// ------------------------------------------------------------------
const getExitPassById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid exit pass id." });
    }

    const exitPass = await ExitPass.findOne({
      _id: id,
      ...tenantFilter(req),
    })
      .populate("student_id", "first_name last_name controlNumber")
      .populate("group_id", "grade section")
      .populate("created_by", "name last_name")
      .lean();

    if (!exitPass) {
      return res.status(404).json({ message: "Exit pass not found." });
    }

    return res.json({ success: true, data: exitPass });
  } catch (error) {
    next(error);
  }
};

// ------------------------------------------------------------------
// PATCH /api/exit-passes/:id/cancel
// Cancelar un pase de salida (soft-cancel).
// ------------------------------------------------------------------
const cancelExitPass = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid exit pass id." });
    }

    const exitPass = await ExitPass.findOne({
      _id: id,
      ...tenantFilter(req),
    });

    if (!exitPass) {
      return res.status(404).json({ message: "Exit pass not found." });
    }

    if (exitPass.status === "cancelled") {
      return res.status(400).json({ message: "Exit pass is already cancelled." });
    }

    exitPass.status = "cancelled";
    await exitPass.save();

    const populated = await ExitPass.findById(exitPass._id)
      .populate("student_id", "first_name last_name controlNumber")
      .populate("group_id", "grade section")
      .populate("created_by", "name last_name")
      .lean();

    return res.json({ success: true, data: populated });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createExitPass,
  listExitPasses,
  getExitPassById,
  cancelExitPass,
};
