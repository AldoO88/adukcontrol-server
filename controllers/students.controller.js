const mongoose = require("mongoose"); // Mongoose para validar ObjectId
const Student = require("../models/Student.model"); // Modelo de Estudiante

const createStudent = async (req, res, next) => { // POST /api/students/register
  try {
    const { // Desestructurar cuerpo
      matricula,
      name,
      apellidos,
      tarjeta_rfid,
      tutores,
      current_group_id,
      status,
    } = req.body;

    const newStudent = await Student.create({ // Mongoose valida
      matricula,
      name,
      apellidos,
      tarjeta_rfid,
      tutores,
      current_group_id,
      status,
    });

    res.status(201).json(newStudent); // 201 + documento
  } catch (error) {
    next(error); // Propagar (ValidationError, 11000)
  }
};

const getAllStudents = async (req, res, next) => { // GET /api/students
  try {
    const { // Parámetros de consulta
      page = 1,
      limit = 20,
      status,
      group,
      search,
      sort = "apellidos",
      order = "asc",
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1); // Mínimo 1
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100); // 1..100

    const filter = {}; // Filtro inicial vacío
    if (status) filter.status = status; // Filtro por estado
    if (group && mongoose.Types.ObjectId.isValid(group)) { // ID válido
      filter.current_group_id = group; // Filtro por grupo
    }
    if (search) { // Búsqueda textual
      const safe = String(search).trim(); // Limpiar
      const regex = new RegExp( // Escapar y compilar
        safe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      filter.$or = [ // Sobre múltiples campos
        { name: regex },
        { apellidos: regex },
        { matricula: regex },
        { tarjeta_rfid: regex },
      ];
    }

    const sortOrder = order === "desc" ? -1 : 1; // Dirección de orden
    const skip = (pageNum - 1) * limitNum; // Desplazamiento

    const [items, total] = await Promise.all([ // En paralelo
      Student.find(filter) // Consultar
        .populate("current_group_id", "grado grupo ciclo_escolar") // Unir grupo
        .sort({ [sort]: sortOrder }) // Aplicar orden
        .skip(skip) // Desplazar
        .limit(limitNum), // Limitar
      Student.countDocuments(filter), // Total de coincidencias
    ]);

    res.status(200).json({ // Respuesta 200
      items, // Filas de la página
      total, // Total que coincide
      page: pageNum, // Página actual
      limit: limitNum, // Tamaño de página
      pages: Math.ceil(total / limitNum) || 1, // Total de páginas
    });
  } catch (error) {
    next(error); // Propagar
  }
};

const getStudentById = async (req, res, next) => { // GET /api/students/:idStudent
  try {
    const { idStudent } = req.params; // Parámetro

    if (!mongoose.Types.ObjectId.isValid(idStudent)) { // ID inválido
      return res.status(404).json({ message: `No student with id: ${idStudent}` });
    }

    const student = await Student.findById(idStudent).populate( // Buscar
      "current_group_id",
      "grado grupo ciclo_escolar tutor_maestro_id"
    );

    if (!student) { // No encontrado
      return res.status(404).json({ message: `No student with id: ${idStudent}` });
    }

    res.status(200).json(student); // 200 OK
  } catch (error) {
    next(error); // Propagar
  }
};

const updateStudent = async (req, res, next) => { // PUT /api/students/:idStudent
  try {
    const { idStudent } = req.params; // Parámetro

    if (!mongoose.Types.ObjectId.isValid(idStudent)) { // ID inválido
      return res.status(404).json({ message: `No student with id: ${idStudent}` });
    }

    const updated = await Student.findByIdAndUpdate(idStudent, req.body, { // Actualizar
      new: true, // Devolver documento actualizado
      runValidators: true, // Re-ejecutar validadores del esquema
    });

    if (!updated) { // No encontrado
      return res.status(404).json({ message: `No student with id: ${idStudent}` });
    }

    res.status(200).json(updated); // 200 + documento
  } catch (error) {
    next(error); // Propagar
  }
};

const deleteStudent = async (req, res, next) => { // DELETE /api/students/:idStudent
  try {
    const { idStudent } = req.params; // Parámetro

    if (!mongoose.Types.ObjectId.isValid(idStudent)) { // ID inválido
      return res.status(404).json({ message: `No student with id: ${idStudent}` });
    }

    const deleted = await Student.findByIdAndDelete(idStudent); // Eliminar

    if (!deleted) { // No encontrado
      return res.status(404).json({ message: `No student with id: ${idStudent}` });
    }

    res.status(200).json({ message: "Student deleted successfully" }); // 200 OK
  } catch (error) {
    next(error); // Propagar
  }
};

module.exports = { // Exportar
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
};
