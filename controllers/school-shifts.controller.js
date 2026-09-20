// Controlador de Turnos / Campanas (SchoolShift)
// CRUD de turnos escolares con aislamiento multi-tenant.
// Cada turno define la "campana": hora de inicio/fin, módulos y recesos.
const mongoose = require("mongoose");
const SchoolShift = require("../models/SchoolShift.model");
const ClassSchedule = require("../models/ClassSchedule.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// GET /api/school-shifts
// Query params opcionales: school_year_id, shift (matutino/vespertino), isActive
const getAllShifts = async (req, res, next) => {
  try {
    const filter = { ...tenantFilter(req) };

    if (req.query.school_year_id && mongoose.Types.ObjectId.isValid(req.query.school_year_id)) {
      filter.school_year_id = req.query.school_year_id;
    }
    if (req.query.shift) {
      filter.shift = req.query.shift;
    }
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === "true";
    }

    const shifts = await SchoolShift.find(filter)
      .populate("school_year_id", "name startDate endDate isActive")
      .sort({ shift: 1, name: 1 });

    res.status(200).json(shifts);
  } catch (error) {
    next(error);
  }
};

// POST /api/school-shifts
const createShift = async (req, res, next) => {
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

    const newShift = await SchoolShift.create(payload);
    res.status(201).json(newShift);
  } catch (error) {
    next(error);
  }
};

// GET /api/school-shifts/:shiftId
const getShiftById = async (req, res, next) => {
  try {
    const { shiftId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(shiftId)) {
      return res.status(404).json({ message: `No shift with id: ${shiftId}` });
    }

    const shift = await SchoolShift.findOne({
      _id: shiftId,
      ...tenantFilter(req),
    }).populate("school_year_id", "name startDate endDate isActive");

    if (!shift) {
      return res.status(404).json({ message: `No shift with id: ${shiftId}` });
    }

    res.status(200).json(shift);
  } catch (error) {
    next(error);
  }
};

// PUT /api/school-shifts/:shiftId
const updateShift = async (req, res, next) => {
  try {
    const { shiftId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(shiftId)) {
      return res.status(404).json({ message: `No shift with id: ${shiftId}` });
    }

    if (req.payload.role !== "super_admin") {
      delete req.body.school;
    }

    const updated = await SchoolShift.findOneAndUpdate(
      { _id: shiftId, ...tenantFilter(req) },
      req.body,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: `No shift with id: ${shiftId}` });
    }

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/school-shifts/:shiftId
// Verifica que ningún ClassSchedule activo referencie este turno antes de borrar.
const deleteShift = async (req, res, next) => {
  try {
    const { shiftId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(shiftId)) {
      return res.status(404).json({ message: `No shift with id: ${shiftId}` });
    }

    // Verificar referencias en ClassSchedule
    const inUse = await ClassSchedule.exists({
      school_shift_id: shiftId,
      isActive: true,
    });

    if (inUse) {
      return res.status(409).json({
        message: "Cannot delete shift: it is referenced by active class schedules.",
      });
    }

    const deleted = await SchoolShift.findOneAndDelete({
      _id: shiftId,
      ...tenantFilter(req),
    });

    if (!deleted) {
      return res.status(404).json({ message: `No shift with id: ${shiftId}` });
    }

    res.status(200).json({ message: "Shift deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllShifts,
  createShift,
  getShiftById,
  updateShift,
  deleteShift,
};
