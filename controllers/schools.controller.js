// Controlador de Escuelas (Tenants)
// CRUD de los tenants del SaaS. Solo accesible para usuarios con role
// "super_admin". Las funciones administrativas de la plataforma (gestión de
// clientes, suspension, etc.) viven aquí.
const mongoose = require("mongoose");
const School = require("../models/School.model");
const User = require("../models/User.model");

// GET /api/schools
// Listar todas las escuelas (paginado, con búsqueda por nombre o CCT).
const getAllSchools = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, isActive } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = {};
    if (typeof isActive === "string") {
      filter.isActive = isActive === "true";
    }
    if (search) {
      const safe = String(search).trim();
      const regex = new RegExp(
        safe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      filter.$or = [{ name: regex }, { cct: regex }];
    }

    const skip = (pageNum - 1) * limitNum;
    const [items, total] = await Promise.all([
      School.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      School.countDocuments(filter),
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

// POST /api/schools
// Crea una nueva escuela. La CCT debe ser única a nivel global.
const createSchool = async (req, res, next) => {
  try {
    const { name, cct, logo, isActive } = req.body;

    if (!name || !cct) {
      return res
        .status(400)
        .json({ message: "name and cct are required." });
    }

    const newSchool = await School.create({ name, cct, logo, isActive });
    res.status(201).json(newSchool);
  } catch (error) {
    next(error);
  }
};

// GET /api/schools/:schoolId
const getSchoolById = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    res.status(200).json(school);
  } catch (error) {
    next(error);
  }
};

// PUT /api/schools/:schoolId
const updateSchool = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    const updated = await School.findByIdAndUpdate(schoolId, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/schools/:schoolId
// Eliminación física. Generalmente se prefiere desactivar (isActive=false)
// para no romper el historial de datos de la escuela.
const deleteSchool = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    // Bloquear eliminación si hay usuarios o estudiantes asociados
    const [userCount, studentCount] = await Promise.all([
      User.countDocuments({ school: schoolId }),
      require("../models/Student.model").countDocuments({ school: schoolId }),
    ]);

    if (userCount > 0 || studentCount > 0) {
      return res.status(409).json({
        message: `Cannot delete school with associated data (${userCount} users, ${studentCount} students). Deactivate it instead.`,
      });
    }

    const deleted = await School.findByIdAndDelete(schoolId);
    if (!deleted) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    res.status(200).json({ message: "School deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllSchools,
  createSchool,
  getSchoolById,
  updateSchool,
  deleteSchool,
};
