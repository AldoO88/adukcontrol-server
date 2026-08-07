// Controlador de Inscripciones
// Operaciones CRUD sobre el recurso Enrollment, con aislamiento multi-tenant.
//
// Sincronización con Student.current_group_id:
// Al crear/actualizar un enrollment del ciclo ACTIVO de la escuela, se
// actualiza también el campo denormalizado Student.current_group_id.
// Esto evita inconsistencias entre Enrollment (fuente de verdad) y el
// campo cacheado en Student (usado por el filtro ?group=X de GET /students
// y por varios populates del dashboard).
const mongoose = require("mongoose");
const Enrollment = require("../models/Enrollment.model");
const Student = require("../models/Student.model");
const School = require("../models/School.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// Helper: sincroniza el cache Student.current_group_id SOLO si el enrollment
// pertenece al ciclo activo de la escuela. Es idempotente.
// - Si el enrollment es de un ciclo pasado o futuro, NO toca current_group_id
//   (preserva el valor del año activo, que es lo que el campo representa).
// - Si la escuela no tiene ciclo activo configurado, no hace nada.
const syncStudentCurrentGroup = async (studentId, groupId, schoolYearId, schoolId) => {
  if (!studentId || !groupId || !schoolYearId || !schoolId) return;
  const school = await School.findById(schoolId)
    .select("current_school_year_id")
    .lean();
  if (!school) return;
  if (String(school.current_school_year_id) !== String(schoolYearId)) return;
  await Student.findByIdAndUpdate(studentId, { current_group_id: groupId });
};

// GET /api/enrollments
const getAllEnrollments = async (req, res, next) => {
  try {
    const { student_id, group_id, school_year_id, cycle_status } = req.query;

    const filter = { ...tenantFilter(req) };
    if (student_id && mongoose.Types.ObjectId.isValid(student_id)) {
      filter.student_id = student_id;
    }
    if (group_id && mongoose.Types.ObjectId.isValid(group_id)) {
      filter.group_id = group_id;
    }
    if (school_year_id && mongoose.Types.ObjectId.isValid(school_year_id)) {
      filter.school_year_id = school_year_id;
    }
    if (cycle_status) filter.cycle_status = cycle_status;

    const enrollments = await Enrollment.find(filter)
      .populate("student_id", "controlNumber first_name last_name")
      .populate("group_id", "grade section school_year_id")
      .populate("school_year_id", "name startDate endDate isActive")
      .sort({ createdAt: -1 });

    res.status(200).json(enrollments);
  } catch (error) {
    next(error);
  }
};

// POST /api/enrollments
// Crea una inscripción y sincroniza Student.current_group_id si aplica.
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

    // Sincronizar el cache denormalizado (solo si es del ciclo activo)
    await syncStudentCurrentGroup(
      newEnrollment.student_id,
      newEnrollment.group_id,
      newEnrollment.school_year_id,
      newEnrollment.school
    );

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
      .populate("student_id", "controlNumber first_name last_name")
      .populate("group_id", "grade section school_year_id")
      .populate("school_year_id", "name startDate endDate isActive");

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
// Actualiza una inscripción. Si cambió el group_id o el school_year_id,
// re-sincroniza Student.current_group_id.
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

    // Si cambió el group o el ciclo, re-sincronizar el cache
    if (req.body.group_id !== undefined || req.body.school_year_id !== undefined) {
      await syncStudentCurrentGroup(
        updated.student_id,
        updated.group_id,
        updated.school_year_id,
        updated.school
      );
    }

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/enrollments/:enrollmentId
// Borra la inscripción. NO tocamos Student.current_group_id — si era del
// ciclo activo, queda con un group_id que ya no tiene Enrollment (caso
// raro, se resuelve reinscribiendo o promoviendo al alumno).
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
