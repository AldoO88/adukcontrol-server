const mongoose = require("mongoose"); // Mongoose para validar ObjectId
const Student = require("../models/Student.model"); // Modelo de Estudiante
const AttendanceLog = require("../models/AttendanceLog.model"); // Modelo de Registro
const notificationService = require("../services/notification.service"); // Servicio FCM

// Función auxiliar para determinar el tipo de registro (entrada/salida) basado en el último registro del estudiante
const determineNextTipo = async (studentId) => { // Alternar entrada/salida
  const lastLog = await AttendanceLog.findOne({ student_id: studentId }) // Último registro
    .sort({ fecha_hora: -1 }) // obtiene el registo más reciente
    .select("tipo"); // Solo necesitamos el tipo

  if (!lastLog) return "entrada"; // Si no hay previos, entrada
  return lastLog.tipo === "entrada" ? "salida" : "entrada"; // Alternar
};

const deviceTriggerController = async (req, res, next) => { // POST /api/attendance/device-trigger
  try {
    const { identificador, tipo_dispositivo, dispositivo_id, fecha_hora } = // Desestructurar cuerpo
      req.body;

    const identifierUpper = String(identificador).toUpperCase().trim(); // Normalizar a mayúsculas

    const student = await Student.findOne({ // Buscar estudiante
      $or: [ // Por RFID o matrícula
        { tarjeta_rfid: identifierUpper },
        { matricula: identifierUpper },
      ],
      status: "activo", // Solo activos
    });

    if (!student) { // No encontrado
      return res
        .status(404)
        .json({ message: `No active student found for identifier '${identificador}'.` });
    }

    const tipo = await determineNextTipo(student._id); // Determinar tipo

    const fechaHoraDate = fecha_hora ? new Date(fecha_hora) : new Date(); // Parsear fecha o ahora
    if (fecha_hora && Number.isNaN(fechaHoraDate.getTime())) { // Fecha inválida
      return res
        .status(400)
        .json({ message: "fecha_hora is not a valid ISO 8601 date." });
    }

    const dispositivoLabel = `${tipo_dispositivo || "desconocido"}@${dispositivo_id}`; // Etiqueta del dispositivo

    const attendanceLog = await AttendanceLog.create({ // Crear registro
      student_id: student._id, // ID del estudiante
      fecha_hora: fechaHoraDate, // Momento
      tipo, // entrada o salida
      dispositivo: dispositivoLabel, // Origen
    });

    process.nextTick(() => { // Despacho no bloqueante de FCM
      (async () => { // IIFE asíncrono
        try {
          const result = await notificationService.sendAttendanceNotification( // Enviar push
            student,
            attendanceLog
          );
          if (result && result.dispatched && result.dispatched > 0) { // Si se enviaron
            await AttendanceLog.updateOne( // Marcar como enviado
              { _id: attendanceLog._id },
              { $set: { notificacion_enviada: true } }
            );
            console.log( // Log de éxito
              `[attendance] Push notifications dispatched for log ${attendanceLog._id} (${result.dispatched}/${result.tokens || 0})`
            );
          } else { // Nada que enviar
            console.log( // Log informativo
              `[attendance] No push notifications dispatched for log ${attendanceLog._id}: ${
                result && result.reason ? result.reason : "unknown"
              }`
            );
          }
        } catch (err) { // Error en background
          console.error( // Log de error
            `[attendance] Background notification error for log ${attendanceLog._id}: ${err.message}`
          );
        }
      })();
    });

    res.status(201).json({ // 201 Created
      log: attendanceLog, // Registro creado
      student: { // Datos del estudiante
        _id: student._id,
        matricula: student.matricula,
        name: student.name,
        apellidos: student.apellidos,
      },
      tipo, // Tipo asignado
      notificacion_en_cola: true, // Notificación encolada
    });
  } catch (error) {
    next(error); // Propagar
  }
};

const getAttendanceLogsController = async (req, res, next) => { // GET /api/attendance/logs
  try {
    const { student_id, from, to, tipo, page = 1, limit = 50 } = req.query; // Parámetros

    const filter = {}; // Filtro inicial

    if (student_id) { // Filtrar por estudiante
      if (!mongoose.Types.ObjectId.isValid(student_id)) { // ID inválido
        return res.status(400).json({ message: "Invalid student_id." });
      }
      filter.student_id = student_id; // Aplicar filtro
    }

    if (tipo && ["entrada", "salida"].includes(tipo)) { // Validar tipo
      filter.tipo = tipo; // Aplicar filtro
    }

    if (from || to) { // Rango de fechas
      filter.fecha_hora = {}; // Inicializar rango
      if (from) { // Fecha desde
        const fromDate = new Date(from); // Parsear
        if (Number.isNaN(fromDate.getTime())) { // Inválida
          return res.status(400).json({ message: "from is not a valid date." });
        }
        filter.fecha_hora.$gte = fromDate; // Mayor o igual
      }
      if (to) { // Fecha hasta
        const toDate = new Date(to); // Parsear
        if (Number.isNaN(toDate.getTime())) { // Inválida
          return res.status(400).json({ message: "to is not a valid date." });
        }
        filter.fecha_hora.$lte = toDate; // Menor o igual
      }
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1); // Mínimo 1
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200); // 1..200
    const skip = (pageNum - 1) * limitNum; // Desplazamiento

    const [items, total] = await Promise.all([ // En paralelo
      AttendanceLog.find(filter) // Consultar
        .populate("student_id", "matricula name apellidos") // Unir estudiante
        .sort({ fecha_hora: -1 }) // Más reciente primero
        .skip(skip) // Desplazar
        .limit(limitNum), // Limitar
      AttendanceLog.countDocuments(filter), // Total
    ]);

    res.status(200).json({ // 200 OK
      items, // Filas
      total, // Total
      page: pageNum, // Página
      limit: limitNum, // Tamaño
      pages: Math.ceil(total / limitNum) || 1, // Páginas
    });
  } catch (error) {
    next(error); // Propagar
  }
};

module.exports = { // Exportar
  deviceTriggerController,
  getAttendanceLogsController,
};
