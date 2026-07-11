const mongoose = require("mongoose"); // Mongoose para validar ObjectId
const Enrollment = require("../models/Enrollment.model"); // Modelo de Inscripción

const getAllEnrollments = async (req, res, next) => { // GET /api/enrollments
  try {
    const { student_id, group_id, ciclo_escolar, estatus_ciclo } = req.query; // Filtros

    const filter = {}; // Filtro inicial
    if (student_id && mongoose.Types.ObjectId.isValid(student_id)) { // ID válido
      filter.student_id = student_id; // Filtrar por estudiante
    }
    if (group_id && mongoose.Types.ObjectId.isValid(group_id)) { // ID válido
      filter.group_id = group_id; // Filtrar por grupo
    }
    if (ciclo_escolar) filter.ciclo_escolar = ciclo_escolar; // Filtrar por ciclo
    if (estatus_ciclo) filter.estatus_ciclo = estatus_ciclo; // Filtrar por estatus

    const enrollments = await Enrollment.find(filter) // Consultar
      .populate("student_id", "matricula name apellidos") // Unir estudiante
      .populate("group_id", "grado grupo ciclo_escolar") // Unir grupo
      .sort({ createdAt: -1 }); // Más reciente primero

    res.status(200).json(enrollments); // 200 + lista
  } catch (error) {
    next(error); // Propagar
  }
};

const createEnrollment = async (req, res, next) => { // POST /api/enrollments
  try {
    const { student_id, group_id, ciclo_escolar, estatus_ciclo } = req.body; // Desestructurar

    const newEnrollment = await Enrollment.create({ // Mongoose valida
      student_id,
      group_id,
      ciclo_escolar,
      estatus_ciclo,
    });

    res.status(201).json(newEnrollment); // 201 + documento
  } catch (error) {
    next(error); // Propagar
  }
};

const getEnrollmentById = async (req, res, next) => { // GET /api/enrollments/:idEnrollment
  try {
    const { idEnrollment } = req.params; // Parámetro

    if (!mongoose.Types.ObjectId.isValid(idEnrollment)) { // ID inválido
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${idEnrollment}` });
    }

    const enrollment = await Enrollment.findById(idEnrollment) // Buscar
      .populate("student_id", "matricula name apellidos") // Unir estudiante
      .populate("group_id", "grado grupo ciclo_escolar"); // Unir grupo

    if (!enrollment) { // No encontrado
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${idEnrollment}` });
    }

    res.status(200).json(enrollment); // 200 OK
  } catch (error) {
    next(error); // Propagar
  }
};

const updateEnrollment = async (req, res, next) => { // PUT /api/enrollments/:idEnrollment
  try {
    const { idEnrollment } = req.params; // Parámetro

    if (!mongoose.Types.ObjectId.isValid(idEnrollment)) { // ID inválido
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${idEnrollment}` });
    }

    const updated = await Enrollment.findByIdAndUpdate(idEnrollment, req.body, { // Actualizar
      new: true, // Devolver actualizado
      runValidators: true, // Re-validar
    });

    if (!updated) { // No encontrado
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${idEnrollment}` });
    }

    res.status(200).json(updated); // 200 + documento
  } catch (error) {
    next(error); // Propagar
  }
};

const deleteEnrollment = async (req, res, next) => { // DELETE /api/enrollments/:idEnrollment
  try {
    const { idEnrollment } = req.params; // Parámetro

    if (!mongoose.Types.ObjectId.isValid(idEnrollment)) { // ID inválido
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${idEnrollment}` });
    }

    const deleted = await Enrollment.findByIdAndDelete(idEnrollment); // Eliminar

    if (!deleted) { // No encontrado
      return res
        .status(404)
        .json({ message: `No enrollment with id: ${idEnrollment}` });
    }

    res.status(200).json({ message: "Enrollment deleted successfully" }); // 200 OK
  } catch (error) {
    next(error); // Propagar
  }
};

module.exports = { // Exportar
  getAllEnrollments,
  createEnrollment,
  getEnrollmentById,
  updateEnrollment,
  deleteEnrollment,
};
