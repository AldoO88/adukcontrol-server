// Controlador de Grupos
// Operaciones CRUD sobre el recurso Group, con aislamiento multi-tenant.
const mongoose = require("mongoose");
const Group = require("../models/Group.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// GET /api/groups
const getAllGroups = async (req, res, next) => {
  try {
    const groups = await Group.find(tenantFilter(req))
      .populate("head_teacher_id", "first_name last_name email role")
      .sort({ grade: 1, section: 1, school_year: 1 });
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
    }).populate("head_teacher_id", "first_name last_name email role");

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

module.exports = {
  getAllGroups,
  createGroup,
  getGroupById,
  updateGroup,
  deleteGroup,
};
