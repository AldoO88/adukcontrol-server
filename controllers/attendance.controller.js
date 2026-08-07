// Controlador de Asistencia
// Maneja los eventos de dispositivos (RFID/cámaras) y la consulta de historial.
// Las queries se filtran por la escuela del usuario autenticado.
// El endpoint /device-trigger usa la API key del dispositivo (no JWT),
// por lo que ahí se identifica la escuela a partir del estudiante.
const mongoose = require("mongoose");
const Student = require("../models/Student.model");
const AttendanceLog = require("../models/AttendanceLog.model");
const attendanceService = require("../services/attendance.service");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// Mapea el device_type que manda el lector al verificationMode del log.
// Los lectores faciales propios se identifican con "face"/"facial"/"camera";
// cualquier otro valor (o ninguno) se trata como lectura de tarjeta.
const FACE_DEVICE_TYPES = new Set(["face", "facial", "camera", "zkteco"]);
const resolveVerificationMode = (deviceType) =>
  FACE_DEVICE_TYPES.has(String(deviceType || "").toLowerCase())
    ? "FACE"
    : "RFID";

// POST /api/attendance/device-trigger
// Auth: API key del dispositivo (no JWT). No hay req.payload, pero el school
// se puede obtener del estudiante (ya validado que pertenezca a una escuela activa).
const deviceTriggerController = async (req, res, next) => {
  try {
    const { identifier, device_type, device_id, event_time, snapshot_url } =
      req.body;

    const identifierUpper = String(identifier).toUpperCase().trim();
    // El biometricId se compara SIN uppercase: es el User ID literal de la
    // terminal facial (puede llevar ceros a la izquierda y no se normaliza).
    const identifierRaw = String(identifier).trim();

    const student = await Student.findOne({
      $or: [
        { rfid_card: identifierUpper },
        { biometricId: identifierRaw },
        { controlNumber: identifierUpper },
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

    const eventTimeDate = event_time ? new Date(event_time) : new Date();
    if (event_time && Number.isNaN(eventTimeDate.getTime())) {
      return res
        .status(400)
        .json({ message: "event_time is not a valid ISO 8601 date." });
    }

    const deviceLabel = `${device_type || "unknown"}@${device_id}`;

    // La creación del log, la invalidación de cache y la notificación en
    // segundo plano viven en el servicio (compartido con el push ADMS).
    const { log, eventType, duplicate } =
      await attendanceService.registerAttendanceEvent({
        student,
        eventTime: eventTimeDate,
        device: deviceLabel,
        verificationMode: resolveVerificationMode(device_type),
        snapshotUrl: snapshot_url || null,
      });

    res.status(duplicate ? 200 : 201).json({
      log,
      student: {
        _id: student._id,
        controlNumber: student.controlNumber,
        first_name: student.first_name,
        last_name: student.last_name,
      },
      event_type: eventType,
      duplicate,
      notification_queued: !duplicate,
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
        .populate("student_id", "controlNumber first_name last_name")
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
