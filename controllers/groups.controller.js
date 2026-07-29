// Controlador de Grupos
// Operaciones CRUD sobre el recurso Group, con aislamiento multi-tenant.
const mongoose = require("mongoose");
const Group = require("../models/Group.model");
const Enrollment = require("../models/Enrollment.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// GET /api/groups
// Query params opcionales:
//   - school_year_id: filtra por ciclo específico (ObjectId de SchoolYear)
//   - grade: filtra por grado (1, 2, 3)
//   - section: filtra por sección (case-insensitive)
const getAllGroups = async (req, res, next) => {
  try {
    const filter = { ...tenantFilter(req) };
    if (req.query.school_year_id && mongoose.Types.ObjectId.isValid(req.query.school_year_id)) {
      filter.school_year_id = req.query.school_year_id;
    }
    if (req.query.grade) {
      const g = parseInt(req.query.grade, 10);
      if (!Number.isNaN(g)) filter.grade = g;
    }
    if (req.query.section) {
      filter.section = String(req.query.section).toUpperCase();
    }

    const groups = await Group.find(filter)
      .populate("head_teacher_id", "first_name last_name email role")
      .populate("school_year_id", "name startDate endDate isActive")
      .sort({ grade: 1, section: 1 });
    res.status(200).json(groups);
  } catch (error) {
    next(error);
  }
};

// POST /api/groups
const createGroup = async (req, res, next) => {
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

    const newGroup = await Group.create(payload);
    res.status(201).json(newGroup);
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId
const getGroupById = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(404).json({ message: `No group with id: ${groupId}` });
    }

    const group = await Group.findOne({
      _id: groupId,
      ...tenantFilter(req),
    })
      .populate("head_teacher_id", "first_name last_name email role")
      .populate("school_year_id", "name startDate endDate isActive");

    if (!group) {
      return res.status(404).json({ message: `No group with id: ${groupId}` });
    }

    res.status(200).json(group);
  } catch (error) {
    next(error);
  }
};

// PUT /api/groups/:groupId
const updateGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(404).json({ message: `No group with id: ${groupId}` });
    }

    if (req.payload.role !== "super_admin") {
      delete req.body.school;
    }

    const updated = await Group.findOneAndUpdate(
      { _id: groupId, ...tenantFilter(req) },
      req.body,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: `No group with id: ${groupId}` });
    }

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/groups/:groupId
const deleteGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(404).json({ message: `No group with id: ${groupId}` });
    }

    const deleted = await Group.findOneAndDelete({
      _id: groupId,
      ...tenantFilter(req),
    });

    if (!deleted) {
      return res.status(404).json({ message: `No group with id: ${groupId}` });
    }

    res.status(200).json({ message: "Group deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// GET /api/groups/:groupId/students
// Devuelve TODOS los estudiantes que estuvieron (o están) en este grupo,
// a lo largo de todos los ciclos escolares. Usa la junction table Enrollment
// para resolver la lista histórica, e incluye el status de cada uno
// (enrolled/graduated/withdrawn/transferred).
//
// Útil para: "¿Quiénes estaban en 1°A en 2023-2024?" o "¿Cuántos alumnos
// pasaron por este grupo en total?"
const getGroupStudents = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(404).json({ message: `No group with id: ${groupId}` });
    }

    // Verificar que el grupo existe y pertenece al tenant
    const group = await Group.findOne({
      _id: groupId,
      ...tenantFilter(req),
    });
    if (!group) {
      return res.status(404).json({ message: `No group with id: ${groupId}` });
    }

    // Buscar todas las Enrollments de este grupo
    const enrollments = await Enrollment.find({ group_id: groupId })
      .populate("student_id", "enrollment_number first_name last_name status photoUrl current_group_id")
      .populate("school_year_id", "name startDate endDate isActive")
      .sort({ createdAt: -1 });

    res.status(200).json({
      group: {
        _id: group._id,
        grade: group.grade,
        section: group.section,
        school_year_id: group.school_year_id,
        shift: group.shift,
      },
      items: enrollments,
      total: enrollments.length,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllGroups,
  createGroup,
  getGroupById,
  updateGroup,
  deleteGroup,
  getGroupStudents,
};
