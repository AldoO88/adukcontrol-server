const mongoose = require("mongoose"); // Mongoose para validar ObjectId
const Group = require("../models/Group.model"); // Modelo de Grupo

const getAllGroups = async (req, res, next) => { // GET /api/groups
  try {
    const groups = await Group.find() // Consultar todos
      .populate("tutor_maestro_id", "name email role") // Unir maestro
      .sort({ grado: 1, grupo: 1, ciclo_escolar: 1 }); // Orden
    res.status(200).json(groups); // 200 + lista
  } catch (error) {
    next(error); // Propagar
  }
};

const createGroup = async (req, res, next) => { // POST /api/groups
  try {
    const { grado, grupo, ciclo_escolar, tutor_maestro_id } = req.body; // Desestructurar

    const newGroup = await Group.create({ // Mongoose valida
      grado,
      grupo,
      ciclo_escolar,
      tutor_maestro_id,
    });

    res.status(201).json(newGroup); // 201 + documento
  } catch (error) {
    next(error); // Propagar
  }
};

const getGroupById = async (req, res, next) => { // GET /api/groups/:idGroup
  try {
    const { idGroup } = req.params; // Parámetro

    if (!mongoose.Types.ObjectId.isValid(idGroup)) { // ID inválido
      return res.status(404).json({ message: `No group with id: ${idGroup}` });
    }

    const group = await Group.findById(idGroup).populate( // Buscar
      "tutor_maestro_id",
      "name email role"
    );

    if (!group) { // No encontrado
      return res.status(404).json({ message: `No group with id: ${idGroup}` });
    }

    res.status(200).json(group); // 200 OK
  } catch (error) {
    next(error); // Propagar
  }
};

const updateGroup = async (req, res, next) => { // PUT /api/groups/:idGroup
  try {
    const { idGroup } = req.params; // Parámetro

    if (!mongoose.Types.ObjectId.isValid(idGroup)) { // ID inválido
      return res.status(404).json({ message: `No group with id: ${idGroup}` });
    }

    const updated = await Group.findByIdAndUpdate(idGroup, req.body, { // Actualizar
      new: true, // Devolver actualizado
      runValidators: true, // Re-validar
    });

    if (!updated) { // No encontrado
      return res.status(404).json({ message: `No group with id: ${idGroup}` });
    }

    res.status(200).json(updated); // 200 + documento
  } catch (error) {
    next(error); // Propagar
  }
};

const deleteGroup = async (req, res, next) => { // DELETE /api/groups/:idGroup
  try {
    const { idGroup } = req.params; // Parámetro

    if (!mongoose.Types.ObjectId.isValid(idGroup)) { // ID inválido
      return res.status(404).json({ message: `No group with id: ${idGroup}` });
    }

    const deleted = await Group.findByIdAndDelete(idGroup); // Eliminar

    if (!deleted) { // No encontrado
      return res.status(404).json({ message: `No group with id: ${idGroup}` });
    }

    res.status(200).json({ message: "Group deleted successfully" }); // 200 OK
  } catch (error) {
    next(error); // Propagar
  }
};

module.exports = { // Exportar
  getAllGroups,
  createGroup,
  getGroupById,
  updateGroup,
  deleteGroup,
};
