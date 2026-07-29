// Controlador de Asistencia
// Maneja los eventos de dispositivos (RFID/cámaras) y la consulta de historial.
// Las queries se filtran por la escuela del usuario autenticado.
// El endpoint /device-trigger usa la API key del dispositivo (no JWT),
// por lo que ahí se identifica la escuela a partir del estudiante.
const mongoose = require("mongoose");
const Student = require("../models/Student.model");
const AttendanceLog = require("../models/AttendanceLog.model");
const Guardian = require("../models/Guardian.model");
const notificationService = require("../services/notification.service");
const cache = require("../services/cache.service");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// Determina el siguiente tipo de evento (entry/exit) para un estudiante.
const determineNextType = async (studentId) => {
  const lastLog = await AttendanceLog.findOne({ student_id: studentId })
    .sort({ event_time: -1 })
    .select("event_type");

  if (!lastLog) return "entry";
  return lastLog.event_type === "entry" ? "exit" : "entry";
};

// POST /api/attendance/device-trigger
// Auth: API key del dispositivo (no JWT). No hay req.payload, pero el school
// se puede obtener del estudiante (ya validado que pertenezca a una escuela activa).
const deviceTriggerController = async (req, res, next) => {
  try {
    const { identifier, device_type, device_id, event_time } = req.body;

    const identifierUpper = String(identifier).toUpperCase().trim();

    const student = await Student.findOne({
      $or: [
        { rfid_card: identifierUpper },
        { enrollment_number: identifierUpper },
      ],
      status: "active",
    });

    if (!student) {
      return res
        .status(404)
        .json({ message: `No active student found for identifier '${identifier}'.` });
    }

    // El student DEBE tener school (validación a nivel de modelo).
    // Si por algún motivo no lo tiene, rechazar para no crear logs huérfanos.
    if (!student.school) {
      return res
        .status(500)
        .json({ message: "Student has no school assigned. Contact support." });
    }

    const eventType = await determineNextType(student._id);

    const eventTimeDate = event_time ? new Date(event_time) : new Date();
    if (event_time && Number.isNaN(eventTimeDate.getTime())) {
      return res
        .status(400)
        .json({ message: "event_time is not a valid ISO 8601 date." });
    }

    const deviceLabel = `${device_type || "unknown"}@${device_id}`;

    // Desnormalizar school desde el student para acelerar queries tenant-scoped
    const attendanceLog = await AttendanceLog.create({
      school: student.school,
      student_id: student._id,
      event_time: eventTimeDate,
      event_type: eventType,
      device: deviceLabel,
    });

    // Invalidar cache de los tutores afectados — para que el próximo GET del
    // dashboard vea el nuevo evento al instante (sin esperar el TTL de 5 min).
    // Busca todos los Guardian records que tienen a este student y borra
    // su cache de dashboard y de student-grades.
    try {
      const affectedGuardians = await Guardian.find({ students: student._id })
        .select("user_id")
        .lean();
      for (const g of affectedGuardians) {
        await cache.invalidatePattern(`dashboard:${String(g.user_id)}:*`);
        await cache.invalidatePattern(
          `student-grades:${String(g.user_id)}:${String(student._id)}*`
        );
      }
      if (affectedGuardians.length > 0) {
        console.log(
          `[attendance] Invalidated cache for ${affectedGuardians.length} guardian(s) of student ${student._id}`
        );
      }
    } catch (cacheErr) {
      // No crítico: el cache tiene TTL y se autorrecupera
      console.warn(
        `[attendance] Cache invalidation failed: ${cacheErr.message}`
      );
    }

    process.nextTick(() => {
      (async () => {
        try {
          const result = await notificationService.sendAttendanceNotification(
            student,
            attendanceLog
          );
          if (result && result.dispatched && result.dispatched > 0) {
            await AttendanceLog.updateOne(
              { _id: attendanceLog._id },
              { $set: { notification_sent: true } }
            );
            console.log(
              `[attendance] Push notifications dispatched for log ${attendanceLog._id} (${result.dispatched}/${result.tokens || 0})`
            );
          } else {
            console.log(
              `[attendance] No push notifications dispatched for log ${attendanceLog._id}: ${
                result && result.reason ? result.reason : "unknown"
              }`
            );
          }
        } catch (err) {
          console.error(
            `[attendance] Background notification error for log ${attendanceLog._id}: ${err.message}`
          );
        }
      })();
    });

    res.status(201).json({
      log: attendanceLog,
      student: {
        _id: student._id,
        enrollment_number: student.enrollment_number,
        first_name: student.first_name,
        last_name: student.last_name,
      },
      event_type: eventType,
      notification_queued: true,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/attendance/logs
// Auth: JWT. Filtra por la escuela del usuario (super_admin ve todas).
const getAttendanceLogsController = async (req, res, next) => {
  try {
    const { student_id, from, to, event_type, page = 1, limit = 50 } = req.query;

    const filter = { ...tenantFilter(req) };

    if (student_id) {
      if (!mongoose.Types.ObjectId.isValid(student_id)) {
        return res.status(400).json({ message: "Invalid student_id." });
      }
      filter.student_id = student_id;
    }

    if (event_type && ["entry", "exit"].includes(event_type)) {
      filter.event_type = event_type;
    }

    if (from || to) {
      filter.event_time = {};
      if (from) {
        const fromDate = new Date(from);
        if (Number.isNaN(fromDate.getTime())) {
          return res.status(400).json({ message: "from is not a valid date." });
        }
        filter.event_time.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (Number.isNaN(toDate.getTime())) {
          return res.status(400).json({ message: "to is not a valid date." });
        }
        filter.event_time.$lte = toDate;
      }
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      AttendanceLog.find(filter)
        .populate("student_id", "enrollment_number first_name last_name")
        .sort({ event_time: -1 })
        .skip(skip)
        .limit(limitNum),
      AttendanceLog.countDocuments(filter),
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

module.exports = {
  deviceTriggerController,
  getAttendanceLogsController,
};
