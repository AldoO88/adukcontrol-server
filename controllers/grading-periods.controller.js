// Controlador de Períodos de Evaluación (GradingPeriod)
// CRUD de períodos con aislamiento multi-tenant.
// Cada escuela define sus propios períodos (trimestres, bimestres, etc.)
// con fechas de inicio y fin para cada ciclo escolar.
const mongoose = require("mongoose");
const GradingPeriod = require("../models/GradingPeriod.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// GET /api/grading-periods
// Query params opcionales: school_year_id, isClosed
const getAllPeriods = async (req, res, next) => {
  try {
    const filter = { ...tenantFilter(req) };

    if (req.query.school_year_id && mongoose.Types.ObjectId.isValid(req.query.school_year_id)) {
      filter.school_year_id = req.query.school_year_id;
    }
    if (req.query.isClosed !== undefined) {
      filter.isClosed = req.query.isClosed === "true";
    }

    const periods = await GradingPeriod.find(filter)
      .populate("school_year_id", "name startDate endDate isActive")
      .sort({ school_year_id: 1, order: 1 });

    res.status(200).json(periods);
  } catch (error) {
    next(error);
  }
};

// POST /api/grading-periods
const createPeriod = async (req, res, next) => {
  try {
    const isSuperAdmin = req.payload.role === "super_admin";
    const payload = { ...req.body };

    if (isSuperAdmin) {
      if (!payload.school) {
        return res
          .status(400)
          .json({ message: "school is required in body for super_admin." });
      }
    } else {
      payload.school = req.payload.schoolId;
    }

    const newPeriod = await GradingPeriod.create(payload);
    res.status(201).json(newPeriod);
  } catch (error) {
    next(error);
  }
};

// GET /api/grading-periods/:periodId
const getPeriodById = async (req, res, next) => {
  try {
    const { periodId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(periodId)) {
      return res.status(404).json({ message: `No grading period with id: ${periodId}` });
    }

    const period = await GradingPeriod.findOne({
      _id: periodId,
      ...tenantFilter(req),
    }).populate("school_year_id", "name startDate endDate isActive");

    if (!period) {
      return res.status(404).json({ message: `No grading period with id: ${periodId}` });
    }

    res.status(200).json(period);
  } catch (error) {
    next(error);
  }
};

// PUT /api/grading-periods/:periodId
const updatePeriod = async (req, res, next) => {
  try {
    const { periodId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(periodId)) {
      return res.status(404).json({ message: `No grading period with id: ${periodId}` });
    }

    if (req.payload.role !== "super_admin") {
      delete req.body.school;
    }

    const updated = await GradingPeriod.findOneAndUpdate(
      { _id: periodId, ...tenantFilter(req) },
      req.body,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: `No grading period with id: ${periodId}` });
    }

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/grading-periods/:periodId
const deletePeriod = async (req, res, next) => {
  try {
    const { periodId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(periodId)) {
      return res.status(404).json({ message: `No grading period with id: ${periodId}` });
    }

    const deleted = await GradingPeriod.findOneAndDelete({
      _id: periodId,
      ...tenantFilter(req),
    });

    if (!deleted) {
      return res.status(404).json({ message: `No grading period with id: ${periodId}` });
    }

    res.status(200).json({ message: "Grading period deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllPeriods,
  createPeriod,
  getPeriodById,
  updatePeriod,
  deletePeriod,
};
