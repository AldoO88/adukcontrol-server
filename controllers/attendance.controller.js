// Controlador de Asistencia
// Maneja los eventos de dispositivos (RFID/cámaras) y la consulta de historial.
// Las queries se filtran por la escuela del usuario autenticado.
// El endpoint /device-trigger usa la API key del dispositivo (no JWT),
// por lo que ahí se identifica la escuela a partir del estudiante.
const mongoose = require("mongoose");
const Student = require("../models/Student.model");
const AttendanceLog = require("../models/AttendanceLog.model");
const attendanceService = require("../services/attendance.service");
const notificationService = require("../services/notification.service");

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
    const {
      identifier,
      device_type,
      device_id,
      event_time,
      snapshot_url,
      status: manualStatus,
      student_id: manualStudentId,
    } = req.body;

    // === Modo ausencia manual ===
    // Si se envía status: "absent", se crea un log de ausencia sin buscar
    // el student por identifier (se usa student_id del body directamente).
    if (manualStatus === "absent") {
      if (!manualStudentId || !mongoose.Types.ObjectId.isValid(manualStudentId)) {
        return res
          .status(400)
          .json({ message: "student_id is required when status is 'absent'." });
      }
      const student = await Student.findOne({
        _id: manualStudentId,
        status: "active",
      }).select("_id school controlNumber first_name last_name");
      if (!student) {
        return res
          .status(404)
          .json({ message: `No active student with id '${manualStudentId}'.` });
      }
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

      const log = await attendanceService.registerAbsence({
        student,
        eventTime: eventTimeDate,
      });

      return res.status(201).json({
        log,
        student: {
          _id: student._id,
          controlNumber: student.controlNumber,
          first_name: student.first_name,
          last_name: student.last_name,
        },
        event_type: "entry",
        status: "absent",
        duplicate: false,
      });
    }

    // === Modo normal (dispositivo RFID/facial) ===
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
// Consulta del historial. Auth: JWT. Filtra por la escuela del usuario (super_admin ve todas).
// Soporta filtro por group_id (primero busca student_ids del grupo).
const getAttendanceLogsController = async (req, res, next) => {
  try {
    const { student_id, group_id, from, to, event_type, status, page = 1, limit = 50 } =
      req.query;

    const filter = { ...tenantFilter(req) };

    // Si se pide filter por grupo, buscar los student_ids de ese grupo primero
    if (group_id) {
      if (!mongoose.Types.ObjectId.isValid(group_id)) {
        return res.status(400).json({ message: "Invalid group_id." });
      }
      const groupStudents = await Student.find({
        current_group_id: group_id,
        ...tenantFilter(req),
      }).select("_id");
      const studentIds = groupStudents.map((s) => s._id);
      if (studentIds.length === 0) {
        return res.status(200).json({ items: [], total: 0, page: 1, limit: limitNum, pages: 1 });
      }
      filter.student_id = { $in: studentIds };
    }

    if (student_id) {
      if (!mongoose.Types.ObjectId.isValid(student_id)) {
        return res.status(400).json({ message: "Invalid student_id." });
      }
      filter.student_id = student_id;
    }

    if (event_type && ["entry", "exit"].includes(event_type)) {
      filter.event_type = event_type;
    }

    if (status && ["on_time", "late", "absent"].includes(status)) {
      filter.status = status;
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
        .populate("student_id", "controlNumber first_name last_name current_group_id")
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

// POST /api/attendance/manual-override
// Override manual de asistencia por personal de la escuela.
// Auth: JWT + admin/registrar/prefect/super_admin.
// Crea un AttendanceLog con verificationMode: "MANUAL" si no existe uno
// para ese estudiante en esa fecha, o actualiza el status si ya existe.
const manualOverrideController = async (req, res, next) => {
  try {
    const { student_id, date, status, notes } = req.body;

    // Validar student_id
    if (!student_id || !mongoose.Types.ObjectId.isValid(student_id)) {
      return res.status(400).json({ message: "student_id is required and must be valid." });
    }

    // Validar date
    if (!date) {
      return res.status(400).json({ message: "date is required (YYYY-MM-DD)." });
    }
    const targetDate = new Date(date);
    if (Number.isNaN(targetDate.getTime())) {
      return res.status(400).json({ message: "date is not a valid date." });
    }

    // Validar status
    if (!status || status !== "present") {
      return res.status(400).json({ message: "status must be 'present'." });
    }

    // Buscar el estudiante (debe pertenecer a la misma escuela)
    const student = await Student.findOne({
      _id: student_id,
      status: "active",
      ...tenantFilter(req),
    }).select("_id school controlNumber first_name last_name");
    if (!student) {
      return res.status(404).json({ message: `No active student with id '${student_id}' in your school.` });
    }

    // Calcular inicio y fin del día en UTC
    const dayStart = new Date(targetDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setUTCHours(23, 59, 59, 999);

    // Buscar si ya existe un log de entrada para este estudiante en esta fecha
    const existingLog = await AttendanceLog.findOne({
      school: student.school,
      student_id: student._id,
      event_type: "entry",
      event_time: { $gte: dayStart, $lte: dayEnd },
    });

    if (existingLog) {
      // Actualizar el status existente
      existingLog.status = "on_time";
      existingLog.verificationMode = "MANUAL";
      if (notes) {
        existingLog.justified = true;
        existingLog.justified_reason = notes;
        existingLog.justified_at = new Date();
      }
      await existingLog.save();

      // Notificar al tutor que el alumno ingresó
      try {
        const populatedLog = await AttendanceLog.findById(existingLog._id).lean();
        notificationService.sendAttendanceNotification(student, populatedLog);
      } catch (notifErr) {
        console.error("Error sending manual override notification:", notifErr.message);
      }

      return res.status(200).json({
        success: true,
        action: "updated",
        log: existingLog,
        student: {
          _id: student._id,
          controlNumber: student.controlNumber,
          first_name: student.first_name,
          last_name: student.last_name,
        },
      });
    }

    // Crear nuevo log de entrada manual
    const newLog = await AttendanceLog.create({
      school: student.school,
      student_id: student._id,
      event_time: targetDate,
      event_type: "entry",
      device: "manual@prefect",
      verificationMode: "MANUAL",
      status: "on_time",
      justified: !!notes,
      justified_reason: notes || null,
      justified_at: notes ? new Date() : null,
    });

    // Notificar al tutor que el alumno ingresó
    try {
      const populatedLog = await AttendanceLog.findById(newLog._id).lean();
      notificationService.sendAttendanceNotification(student, populatedLog);
    } catch (notifErr) {
      console.error("Error sending manual override notification:", notifErr.message);
    }

    return res.status(201).json({
      success: true,
      action: "created",
      log: newLog,
      student: {
        _id: student._id,
        controlNumber: student.controlNumber,
        first_name: student.first_name,
        last_name: student.last_name,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  deviceTriggerController,
  getAttendanceLogsController,
  manualOverrideController,
};
