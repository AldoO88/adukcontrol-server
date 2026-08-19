// Servicio de Asistencia
// Lógica compartida por los dos caminos que generan un AttendanceLog:
//   - POST /api/attendance/device-trigger  (lectores propios, body JSON)
//   - POST /iclock/cdata                   (push ADMS de terminales ZKTeco)
// Ambos hacen exactamente lo mismo una vez identificado al alumno: calcular
// entry/exit, crear el log, invalidar el cache de los tutores y disparar la
// notificación push en segundo plano.
const AttendanceLog = require("../models/AttendanceLog.model");
const Guardian = require("../models/Guardian.model");
const Group = require("../models/Group.model");
const SchoolShift = require("../models/SchoolShift.model");
const notificationService = require("./notification.service");
const cache = require("./cache.service");

// Ventana (ms) dentro de la cual dos eventos idénticos del mismo alumno y
// dispositivo se consideran el mismo evento. Las terminales ADMS reenvían el
// lote completo cuando no reciben un 200, y algunos lectores mandan doble
// pulso; sin esta ventana cada reintento duplicaría el log y la notificación.
const DUPLICATE_WINDOW_MS = 60 * 1000;

// Determina el siguiente tipo de evento (entry/exit) para un estudiante.
// El tipo se alterna a partir del último log: el dispositivo NO decide.
const determineNextType = async (studentId) => {
  const lastLog = await AttendanceLog.findOne({ student_id: studentId })
    .sort({ event_time: -1 })
    .select("event_type");

  if (!lastLog) return "entry";
  return lastLog.event_type === "entry" ? "exit" : "entry";
};

// Busca un log equivalente (mismo alumno, mismo dispositivo, ±1 min) para no
// duplicar en reintentos del dispositivo. Devuelve el log existente o null.
const findRecentDuplicate = async (studentId, device, eventTime) => {
  const from = new Date(eventTime.getTime() - DUPLICATE_WINDOW_MS);
  const to = new Date(eventTime.getTime() + DUPLICATE_WINDOW_MS);

  return AttendanceLog.findOne({
    student_id: studentId,
    device,
    event_time: { $gte: from, $lte: to },
  });
};

// Invalida el cache de dashboard/calificaciones de todos los tutores del
// alumno, para que el próximo GET vea el evento al instante (sin esperar TTL).
// No es crítico: si falla, el cache se autorrecupera al expirar.
const invalidateGuardianCaches = async (student) => {
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
    console.warn(`[attendance] Cache invalidation failed: ${cacheErr.message}`);
  }
};

// Dispara la notificación push fuera del ciclo de respuesta: el dispositivo
// recibe su ACK sin esperar a Firebase.
const dispatchNotificationInBackground = (student, attendanceLog) => {
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
};

// "HH:mm" → minutos desde medianoche. Helper local para no acoplar al modelo.
const toMinutes = (hhmm) => {
  if (typeof hhmm !== "string" || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(hhmm))
    return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Calcula el status de una entrada comparando la hora del evento con la
// hora de inicio del turno del grupo del alumno.
//   on_time → eventMinutes ≤ shiftMinutes
//   late    → eventMinutes >  shiftMinutes
//   null    → no se pudo resolver (sin grupo, sin turno, etc.)
const computeEntryStatus = async (student, eventTime) => {
  try {
    if (!student.current_group_id) return null;

    const group = await Group.findById(student.current_group_id)
      .select("shift school_year_id school")
      .lean();
    if (!group) return null;

    const shift = await SchoolShift.findOne({
      school: group.school,
      school_year_id: group.school_year_id,
      shift: group.shift,
    })
      .select("startTime")
      .lean();
    if (!shift) return null;

    const shiftMinutes = toMinutes(shift.startTime);
    if (shiftMinutes === null) return null;

    // Convertir event_time (UTC) a hora local usando ADMS_TZ_OFFSET_MINUTES.
    // Si no está configurado, se usa 0 (asume server y escuela en misma zona).
    const offset = parseInt(
      process.env.ADMS_TZ_OFFSET_MINUTES || "0",
      10
    );
    const localDate = new Date(eventTime.getTime() + offset * 60000);
    const eventMinutes = localDate.getUTCHours() * 60 + localDate.getUTCMinutes();

    return eventMinutes <= shiftMinutes ? "on_time" : "late";
  } catch (err) {
    console.warn(
      `[attendance] computeEntryStatus failed for student ${student._id}: ${err.message}`
    );
    return null;
  }
};

// Registra un evento de asistencia completo.
// El `school` se desnormaliza desde el estudiante (el caller ya validó que
// exista) para acelerar las queries tenant-scoped.
// Devuelve { log, eventType, duplicate } — `duplicate: true` significa que se
// reutilizó un log existente y NO se volvió a notificar.
const registerAttendanceEvent = async ({
  student,
  eventTime,
  device,
  verificationMode,
  snapshotUrl = null,
}) => {
  const existing = await findRecentDuplicate(student._id, device, eventTime);
  if (existing) {
    return { log: existing, eventType: existing.event_type, duplicate: true };
  }

  const eventType = await determineNextType(student._id);

  // Computar status solo para entry events (comparar con shift startTime)
  let status = null;
  if (eventType === "entry") {
    status = await computeEntryStatus(student, eventTime);
  }

  const log = await AttendanceLog.create({
    school: student.school,
    student_id: student._id,
    event_time: eventTime,
    event_type: eventType,
    device,
    verificationMode,
    snapshotUrl,
    status,
  });

  await invalidateGuardianCaches(student);
  dispatchNotificationInBackground(student, log);

  return { log, eventType, duplicate: false };
};

// Registra una ausencia manual (sin marcación del dispositivo).
// Crea un log con event_type "entry", status "absent", y verificationMode "MANUAL".
const registerAbsence = async ({ student, eventTime, device = "manual@system" }) => {
  const log = await AttendanceLog.create({
    school: student.school,
    student_id: student._id,
    event_time: eventTime,
    event_type: "entry",
    device,
    verificationMode: "MANUAL",
    status: "absent",
  });

  await invalidateGuardianCaches(student);
  return log;
};

module.exports = {
  determineNextType,
  findRecentDuplicate,
  invalidateGuardianCaches,
  dispatchNotificationInBackground,
  registerAttendanceEvent,
  registerAbsence,
  computeEntryStatus,
};
