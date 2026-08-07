// Controlador de Asignaciones Maestro-Materia-Grupo (TeacherSubject)
// CRUD de la matriz de permisos: qué maestro enseña qué materia a qué
// grupo en qué año. Es la base para que un teacher solo pueda calificar
// a los alumnos donde efectivamente da clase.
const mongoose = require("mongoose");
const TeacherSubject = require("../models/TeacherSubject.model");
const User = require("../models/User.model");
const Group = require("../models/Group.model");
const Subject = require("../models/Subject.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

// GET /api/teacher-subjects
// Lista las asignaciones. Filtros: ?teacher_id, ?group_id, ?subject_id, ?school_year_id
const getAllTeacherSubjects = async (req, res, next) => {
  try {
    const filter = { ...tenantFilter(req) };
    if (req.query.teacher_id && mongoose.Types.ObjectId.isValid(req.query.teacher_id)) {
      filter.teacher_id = req.query.teacher_id;
    }
    if (req.query.group_id && mongoose.Types.ObjectId.isValid(req.query.group_id)) {
      filter.group_id = req.query.group_id;
    }
    if (req.query.subject_id && mongoose.Types.ObjectId.isValid(req.query.subject_id)) {
      filter.subject_id = req.query.subject_id;
    }
    if (req.query.school_year_id && mongoose.Types.ObjectId.isValid(req.query.school_year_id)) {
      filter.school_year_id = req.query.school_year_id;
    }

    const assignments = await TeacherSubject.find(filter)
      .populate("teacher_id", "name email role phoneNumber")
      .populate("subject_id", "code name")
      .populate("group_id", "grade section school_year_id shift")
      .populate("school_year_id", "name startDate endDate isActive")
      .sort({ "teacher_id.name": 1 });

    res.status(200).json({ items: assignments, total: assignments.length });
  } catch (error) {
    next(error);
  }
};

// POST /api/teacher-subjects
// Crea una asignación. Auth: admin/registrar.
const createTeacherSubject = async (req, res, next) => {
  try {
    const { teacher_id, subject_id, group_id, school_year_id } = req.body;

    if (!teacher_id || !subject_id || !group_id || !school_year_id) {
      return res
        .status(400)
        .json({ message: "teacher_id, subject_id, group_id, school_year_id are required." });
    }
    if (!mongoose.Types.ObjectId.isValid(teacher_id)) {
      return res.status(400).json({ message: "Invalid teacher_id." });
    }
    if (!mongoose.Types.ObjectId.isValid(subject_id)) {
      return res.status(400).json({ message: "Invalid subject_id." });
    }
    if (!mongoose.Types.ObjectId.isValid(group_id)) {
      return res.status(400).json({ message: "Invalid group_id." });
    }
    if (!mongoose.Types.ObjectId.isValid(school_year_id)) {
      return res.status(400).json({ message: "Invalid school_year_id." });
    }

    // Verificar que el teacher existe y es role=teacher
    const teacher = await User.findById(teacher_id);
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found." });
    }
    if (teacher.role !== "teacher" && teacher.role !== "admin" && teacher.role !== "registrar") {
      return res
        .status(400)
        .json({ message: `User with role '${teacher.role}' cannot be assigned as teacher.` });
    }

    // Verificar que la materia existe y pertenece al tenant
    const subject = await Subject.findOne({
      _id: subject_id,
      ...tenantFilter(req),
    });
    if (!subject) {
      return res.status(404).json({ message: "Subject not found in this tenant." });
    }

    // Verificar que el group existe y pertenece al tenant
    const group = await Group.findOne({
      _id: group_id,
      ...tenantFilter(req),
    });
    if (!group) {
      return res.status(404).json({ message: "Group not found in this tenant." });
    }
    if (group.school_year_id.toString() !== school_year_id) {
      return res
        .status(400)
        .json({ message: `Group school_year_id (${group.school_year_id}) doesn't match the assignment (${school_year_id}).` });
    }

    const school = req.payload.schoolId || req.body.school;
    const assignment = await TeacherSubject.create({
      school: school || group.school,
      teacher_id,
      subject_id,
      group_id,
      school_year_id,
    });
    res.status(201).json(assignment);
  } catch (error) {
    // Duplicate key (mismo teacher+subject+group+year)
    if (error.code === 11000) {
      return res.status(409).json({
        message: "This teacher is already assigned to this subject/group/year.",
      });
    }
    next(error);
  }
};

// DELETE /api/teacher-subjects/:id
const deleteTeacherSubject = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "Assignment not found." });
    }
    const deleted = await TeacherSubject.findOneAndDelete({
      _id: id,
      ...tenantFilter(req),
    });
    if (!deleted) {
      return res.status(404).json({ message: "Assignment not found." });
    }
    res.status(200).json({ message: "Assignment deleted successfully." });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllTeacherSubjects,
  createTeacherSubject,
  deleteTeacherSubject,
};
