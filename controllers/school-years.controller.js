// Controlador de Ciclos Escolares (SchoolYear)
// CRUD del catálogo de ciclos por escuela + activación del ciclo vigente.
// Tenant-scoped: cada escuela solo ve/gestiona sus propios ciclos.
const mongoose = require("mongoose");
const SchoolYear = require("../models/SchoolYear.model");
const School = require("../models/School.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// GET /api/school-years
const getAllSchoolYears = async (req, res, next) => {
  try {
    const filter = { ...tenantFilter(req) };
    const items = await SchoolYear.find(filter).sort({ startDate: -1 });
    res.status(200).json({ items, total: items.length });
  } catch (error) {
    next(error);
  }
};

// POST /api/school-years
// Body: { name, startDate, endDate, school? (solo super_admin) }
const createSchoolYear = async (req, res, next) => {
  try {
    const isSuperAdmin = req.payload.role === "super_admin";
    const { name, startDate, endDate } = req.body;

    if (!name || !startDate || !endDate) {
      return res
        .status(400)
        .json({ message: "name, startDate, and endDate are required." });
    }

    const school = isSuperAdmin ? req.body.school : req.payload.schoolId;
    if (!school) {
      return res
        .status(400)
        .json({ message: "school is required in body for super_admin." });
    }

    const newSchoolYear = await SchoolYear.create({
      school,
      name,
      startDate,
      endDate,
    });
    res.status(201).json(newSchoolYear);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ message: "This school year already exists for this school." });
    }
    next(error);
  }
};

// GET /api/school-years/:schoolYearId
const getSchoolYearById = async (req, res, next) => {
  try {
    const { schoolYearId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
      return res
        .status(404)
        .json({ message: `No school year with id: ${schoolYearId}` });
    }

    const schoolYear = await SchoolYear.findOne({
      _id: schoolYearId,
      ...tenantFilter(req),
    });

    if (!schoolYear) {
      return res
        .status(404)
        .json({ message: `No school year with id: ${schoolYearId}` });
    }

    res.status(200).json(schoolYear);
  } catch (error) {
    next(error);
  }
};

// PUT /api/school-years/:schoolYearId
const updateSchoolYear = async (req, res, next) => {
  try {
    const { schoolYearId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
      return res
        .status(404)
        .json({ message: `No school year with id: ${schoolYearId}` });
    }

    if (req.payload.role !== "super_admin") {
      delete req.body.school;
    }
    // isActive se gestiona exclusivamente vía POST /:schoolYearId/activate
    delete req.body.isActive;

    const updated = await SchoolYear.findOneAndUpdate(
      { _id: schoolYearId, ...tenantFilter(req) },
      req.body,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res
        .status(404)
        .json({ message: `No school year with id: ${schoolYearId}` });
    }

    res.status(200).json(updated);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ message: "This school year already exists for this school." });
    }
    next(error);
  }
};

// DELETE /api/school-years/:schoolYearId
const deleteSchoolYear = async (req, res, next) => {
  try {
    const { schoolYearId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
      return res
        .status(404)
        .json({ message: `No school year with id: ${schoolYearId}` });
    }

    const deleted = await SchoolYear.findOneAndDelete({
      _id: schoolYearId,
      ...tenantFilter(req),
    });

    if (!deleted) {
      return res
        .status(404)
        .json({ message: `No school year with id: ${schoolYearId}` });
    }

    res.status(200).json({ message: "School year deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// POST /api/school-years/:schoolYearId/activate
// Marca este ciclo como el vigente de su escuela: desactiva cualquier otro
// ciclo activo de la misma escuela y sincroniza School.current_school_year_id.
const activateSchoolYear = async (req, res, next) => {
  try {
    const { schoolYearId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
      return res
        .status(404)
        .json({ message: `No school year with id: ${schoolYearId}` });
    }

    const schoolYear = await SchoolYear.findOne({
      _id: schoolYearId,
      ...tenantFilter(req),
    });

    if (!schoolYear) {
      return res
        .status(404)
        .json({ message: `No school year with id: ${schoolYearId}` });
    }

    await SchoolYear.updateMany(
      { school: schoolYear.school, isActive: true },
      { $set: { isActive: false } }
    );
    schoolYear.isActive = true;
    await schoolYear.save();

    await School.findByIdAndUpdate(schoolYear.school, {
      current_school_year_id: schoolYear._id,
    });

    res.status(200).json({
      message: "School year activated successfully.",
      schoolYear,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllSchoolYears,
  createSchoolYear,
  getSchoolYearById,
  updateSchoolYear,
  deleteSchoolYear,
  activateSchoolYear,
};
