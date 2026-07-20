// Controlador de Inscripciones
// Operaciones CRUD sobre el recurso Enrollment, con aislamiento multi-tenant.
const mongoose = require("mongoose");
const Enrollment = require("../models/Enrollment.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// GET /api/enrollments
const getAllEnrollments = async (req, res, next) => {
  try {
    const { student_id, group_id, school_year, cycle_status } = req.query;

    const filter = { ...tenantFilter(req) };
    if (student_id && mongoose.Types.ObjectId.isValid(student_id)) {
      filter.student_id = student_id;
    }
    if (group_id && mongoose.Types.ObjectId.isValid(group_id)) {
      filter.group_id = group_id;
    }
    if (school_year) filter.school_year = school_year;
    if (cycle_status) filter.cycle_status = cycle_status;

    const enrollments = await Enrollment.find(filter)
      .populate("student_id", "enrollment_number first_name last_name")
      .populate("group_id", "grade section school_year")
      .sort({ createdAt: -1 });

    res.status(200).json(enrollments);
  } catch (error) {
    next(error);
  }
};

// POST /api/enrollments
const createEnrollment = async (req, res, next) => {
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

    const newEnrollment = await Enrollment.create(payload);
    res.status(201).json(newEnrollment);
  } catch (error) {
    next(error);
  }
};

// GET /api/enrollments/:enrollmentId
const getEnrollmentById = async (req, res, next) => {
  try {
    const { enrollmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${enrollmentId}` });
    }

    const enrollment = await Enrollment.findOne({
      _id: enrollmentId,
      ...tenantFilter(req),
    })
      .populate("student_id", "enrollment_number first_name last_name")
      .populate("group_id", "grade section school_year");

    if (!enrollment) {
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${enrollmentId}` });
    }

    res.status(200).json(enrollment);
  } catch (error) {
    next(error);
  }
};

// PUT /api/enrollments/:enrollmentId
const updateEnrollment = async (req, res, next) => {
  try {
    const { enrollmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${enrollmentId}` });
    }

    if (req.payload.role !== "super_admin") {
      delete req.body.school;
    }

    const updated = await Enrollment.findOneAndUpdate(
      { _id: enrollmentId, ...tenantFilter(req) },
      req.body,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${enrollmentId}` });
    }

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/enrollments/:enrollmentId
const deleteEnrollment = async (req, res, next) => {
  try {
    const { enrollmentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(enrollmentId)) {
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${enrollmentId}` });
    }

    const deleted = await Enrollment.findOneAndDelete({
      _id: enrollmentId,
      ...tenantFilter(req),
    });

    if (!deleted) {
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${enrollmentId}` });
    }

    res.status(200).json({ message: "Enrollment deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllEnrollments,
  createEnrollment,
  getEnrollmentById,
  updateEnrollment,
  deleteEnrollment,
};
