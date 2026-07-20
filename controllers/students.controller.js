// Controlador de Estudiantes
// Operaciones CRUD sobre el recurso Student, con aislamiento multi-tenant.
// Todas las queries se filtran por la escuela del usuario autenticado
// (req.payload.schoolId), salvo para super_admin que ve todas las escuelas.
const mongoose = require("mongoose");
const Student = require("../models/Student.model");

// Helper: devuelve el filtro base de tenant.
// super_admin no filtra; el resto ve solo su escuela.
const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// POST /api/students/register
// Crea un estudiante. El school se asigna automáticamente desde el JWT
// (super_admin puede especificar otro school en el body).
const createStudent = async (req, res, next) => {
  try {
    const isSuperAdmin = req.payload.role === "super_admin";
    const payload = { ...req.body };

    if (isSuperAdmin) {
      // super_admin DEBE especificar la escuela destino en el body
      if (!payload.school) {
        return res
          .status(400)
          .json({ message: "school is required in body for super_admin." });
      }
    } else {
      // Cualquier otro rol: forzar la escuela del usuario autenticado
      payload.school = req.payload.schoolId;
    }

    const newStudent = await Student.create(payload);
    res.status(201).json(newStudent);
  } catch (error) {
    next(error);
  }
};

// GET /api/students
// Lista paginada y filtrada por tenant.
const getAllStudents = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      group,
      search,
      sort = "last_name",
      order = "asc",
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    // Filtro base: tenant + opcionales
    const filter = { ...tenantFilter(req) };
    if (status) filter.status = status;
    if (group && mongoose.Types.ObjectId.isValid(group)) {
      filter.current_group_id = group;
    }
    if (search) {
      const safe = String(search).trim();
      const regex = new RegExp(
        safe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      filter.$or = [
        { first_name: regex },
        { last_name: regex },
        { enrollment_number: regex },
        { rfid_card: regex },
      ];
    }

    const sortOrder = order === "desc" ? -1 : 1;
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Student.find(filter)
        .populate("current_group_id", "grade section school_year head_teacher_id")
        .sort({ [sort]: sortOrder })
        .skip(skip)
        .limit(limitNum),
      Student.countDocuments(filter),
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

// GET /api/students/:studentId
// findOne con filtro de tenant; nunca usa findById solo.
const getStudentById = async (req, res, next) => {
  try {
    const { studentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: `No student with id: ${studentId}` });
    }

    const student = await Student.findOne({
      _id: studentId,
      ...tenantFilter(req),
    }).populate("current_group_id", "grade section school_year head_teacher_id");

    if (!student) {
      return res.status(404).json({ message: `No student with id: ${studentId}` });
    }

    res.status(200).json(student);
  } catch (error) {
    next(error);
  }
};

// PUT /api/students/:studentId
// findOneAndUpdate con filtro de tenant.
const updateStudent = async (req, res, next) => {
  try {
    const { studentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: `No student with id: ${studentId}` });
    }

    // Evitar que un usuario regular cambie el school a otra escuela
    if (req.payload.role !== "super_admin") {
      delete req.body.school;
    }

    const updated = await Student.findOneAndUpdate(
      { _id: studentId, ...tenantFilter(req) },
      req.body,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ message: `No student with id: ${studentId}` });
    }

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/students/:studentId
// findOneAndDelete con filtro de tenant.
const deleteStudent = async (req, res, next) => {
  try {
    const { studentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: `No student with id: ${studentId}` });
    }

    const deleted = await Student.findOneAndDelete({
      _id: studentId,
      ...tenantFilter(req),
    });

    if (!deleted) {
      return res.status(404).json({ message: `No student with id: ${studentId}` });
    }

    res.status(200).json({ message: "Student deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
};
