// Controlador de Tutores
// Gestión de la relación tutor ↔ estudiantes.
// El tutor puede ver/actualizar su propia lista; admin/registrar pueden
// hacerlo por cualquier tutor de su escuela.
const mongoose = require("mongoose");
const User = require("../models/User.model");
const Student = require("../models/Student.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

// Roles que pueden gestionar la lista de cualquier tutor (no solo el propio)
const ADMIN_LIKE_ROLES = ["admin", "registrar", "super_admin"];

// GET /api/tutors/:userId/students
// Devuelve los estudiantes asignados explícitamente a un tutor.
// Auth: el propio tutor o admin/registrar de la misma escuela.
const getTutorStudents = async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(404).json({ message: "Tutor not found." });
    }

    // Solo el propio tutor o un admin pueden consultar
    const isOwner = String(req.payload._id) === userId;
    const isAdmin = ADMIN_LIKE_ROLES.includes(req.payload.role);
    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ message: "Not authorized to view this tutor's students." });
    }

    const tutor = await User.findOne({
      _id: userId,
      role: "tutor",
      ...tenantFilter(req),
    }).select("_id tutor_of_students school role");

    if (!tutor) {
      return res.status(404).json({ message: "Tutor not found." });
    }

    const students = await Student.find({
      _id: { $in: tutor.tutor_of_students || [] },
    })
      .populate("current_group_id", "grade section school_year")
      .sort({ last_name: 1, first_name: 1 });

    res.status(200).json({
      tutor_id: tutor._id,
      items: students,
      total: students.length,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/tutors/:userId/students
// Reemplaza la lista de estudiantes del tutor con el array recibido.
// Body: { student_ids: [ObjectId, ...] } (array vacío para limpiar)
// Valida que cada ID exista, pertenezca a la misma escuela y esté activo.
const updateTutorStudents = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { student_ids } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(404).json({ message: "Tutor not found." });
    }

    if (!Array.isArray(student_ids)) {
      return res
        .status(400)
        .json({ message: "student_ids must be an array." });
    }

    // Solo el propio tutor o un admin pueden modificar
    const isOwner = String(req.payload._id) === userId;
    const isAdmin = ADMIN_LIKE_ROLES.includes(req.payload.role);
    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ message: "Not authorized to update this tutor's students." });
    }

    const tutor = await User.findOne({
      _id: userId,
      role: "tutor",
      ...tenantFilter(req),
    });

    if (!tutor) {
      return res.status(404).json({ message: "Tutor not found." });
    }

    // Si la lista no está vacía, validar que cada ID exista y pertenezca a la escuela
    if (student_ids.length > 0) {
      const validIds = student_ids.filter((id) =>
        mongoose.Types.ObjectId.isValid(id)
      );
      if (validIds.length !== student_ids.length) {
        return res
          .status(400)
          .json({ message: "All student_ids must be valid ObjectIds." });
      }

      const students = await Student.find({
        _id: { $in: validIds },
        school: tutor.school,
      }).select("_id");

      if (students.length !== validIds.length) {
        return res.status(400).json({
          message:
            "Some student_ids do not exist or belong to a different school.",
        });
      }

      tutor.tutor_of_students = validIds;
    } else {
      tutor.tutor_of_students = [];
    }

    await tutor.save();

    res.status(200).json({
      message: "Tutor students updated successfully",
      tutor_id: tutor._id,
      tutor_of_students: tutor.tutor_of_students,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTutorStudents,
  updateTutorStudents,
};
