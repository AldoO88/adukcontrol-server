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
const SchoolCalendar = require("../models/SchoolCalendar.model");
const Student = require("../models/Student.model");
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

// Dispara notificación de ausencia/retardo fuera del ciclo de respuesta.
// Usa sendAbsenceNotification en vez de sendAttendanceNotification.
const dispatchAbsenceNotificationInBackground = (student, attendanceLog) => {
  process.nextTick(() => {
    (async () => {
      try {
        const result = await notificationService.sendAbsenceNotification(
          student,
          attendanceLog
        );
        if (result && result.dispatched && result.dispatched > 0) {
          await AttendanceLog.updateOne(
            { _id: attendanceLog._id },
            { $set: { notification_sent: true } }
          );
          console.log(
            `[attendance] Absence push dispatched for log ${attendanceLog._id} (${result.dispatched}/${result.tokens || 0})`
          );
        } else {
          console.log(
            `[attendance] No absence push for log ${attendanceLog._id}: ${
              result && result.reason ? result.reason : "unknown"
            }`
          );
        }
      } catch (err) {
        console.error(
          `[attendance] Background absence notification error for log ${attendanceLog._id}: ${err.message}`
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

// Verifica si una fecha es día escolar consultando SchoolCalendar.
// Retorna { isSchoolDay: boolean, reason?: string }.
const isSchoolDay = async (school, schoolYearId, date) => {
  try {
    // Normalizar a inicio del día UTC
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const entry = await SchoolCalendar.findOne({
      school,
      school_year_id: schoolYearId,
      date: startOfDay,
      is_active: true,
    }).select("type name");

    if (!entry) return { isSchoolDay: true };

    return {
      isSchoolDay: false,
      reason: entry.type,
      name: entry.name || entry.type,
    };
  } catch (err) {
    console.warn(
      `[attendance] isSchoolDay failed for school ${school}: ${err.message}`
    );
    // En caso de error, asumir que SÍ es día escolar (mejor marcar ausencia
    // que saltársela silenciosamente).
    return { isSchoolDay: true };
  }
};

// Calcula si un evento cayó después del corte de gracia del turno del alumno.
// El cutoff = startTime + gracePeriodMinutes del SchoolShift.
// Retorna { after: boolean, cutoffMinutes: number, shiftMinutes: number }.
const isAfterGracePeriod = async (student, eventTime) => {
  try {
    if (!student.current_group_id)
      return { after: false, cutoffMinutes: null, shiftMinutes: null };

    const group = await Group.findById(student.current_group_id)
      .select("shift school_year_id school")
      .lean();
    if (!group)
      return { after: false, cutoffMinutes: null, shiftMinutes: null };

    const shift = await SchoolShift.findOne({
      school: group.school,
      school_year_id: group.school_year_id,
      shift: group.shift,
    })
      .select("startTime gracePeriodMinutes")
      .lean();
    if (!shift)
      return { after: false, cutoffMinutes: null, shiftMinutes: null };

    const shiftMinutes = toMinutes(shift.startTime);
    const gracePeriod = shift.gracePeriodMinutes || 30;
    if (shiftMinutes === null)
      return { after: false, cutoffMinutes: null, shiftMinutes: null };

    const cutoffMinutes = shiftMinutes + gracePeriod;

    // Convertir event_time (UTC) a hora local
    const offset = parseInt(
      process.env.ADMS_TZ_OFFSET_MINUTES || "0",
      10
    );
    const localDate = new Date(eventTime.getTime() + offset * 60000);
    const eventMinutes =
      localDate.getUTCHours() * 60 + localDate.getUTCMinutes();

    return {
      after: eventMinutes > cutoffMinutes,
      cutoffMinutes,
      shiftMinutes,
    };
  } catch (err) {
    console.warn(
      `[attendance] isAfterGracePeriod failed for student ${student._id}: ${err.message}`
    );
    return { after: false, cutoffMinutes: null, shiftMinutes: null };
  }
};

// Convierte una fecha UTC a fecha local (solo año-mes-día) usando ADMS_TZ_OFFSET_MINUTES.
const toLocalDate = (utcDate) => {
  const offset = parseInt(process.env.ADMS_TZ_OFFSET_MINUTES || "0", 10);
  const local = new Date(utcDate.getTime() + offset * 60000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  );
};

// Cuando un alumno llega después del corte de gracia y pasa el lector:
// 1. Si ya existe un absent log de hoy → actualiza a "late" con la hora real del tap
// 2. Si no existe → crea entry normal con status "late"
// Retorna { log, wasAbsenceOverride: boolean, duplicate: boolean }.
const resolveLateArrival = async ({
  student,
  eventTime,
  device,
  verificationMode,
  snapshotUrl = null,
}) => {
  const localDate = toLocalDate(eventTime);
  const endOfDay = new Date(localDate.getTime() + 24 * 60 * 60 * 1000);

  // Buscar si ya hay un absent log para este alumno hoy
  const existingAbsent = await AttendanceLog.findOne({
    student_id: student._id,
    event_type: "entry",
    status: "absent",
    event_time: { $gte: localDate, $lt: endOfDay },
  });

  if (existingAbsent) {
    // Actualizar el absent log a late con la hora real del tap
    const updated = await AttendanceLog.findOneAndUpdate(
      { _id: existingAbsent._id },
      {
        $set: {
          status: "late",
          event_time: eventTime,
          device,
          verificationMode,
          snapshotUrl,
        },
      },
      { new: true }
    );

    await invalidateGuardianCaches(student);
    dispatchAbsenceNotificationInBackground(student, updated);

    return { log: updated, wasAbsenceOverride: true, duplicate: false };
  }

  // No hay absent existente → crear entry normal con status "late"
  const log = await AttendanceLog.create({
    school: student.school,
    student_id: student._id,
    event_time: eventTime,
    event_type: "entry",
    device,
    verificationMode,
    snapshotUrl,
    status: "late",
  });

  await invalidateGuardianCaches(student);
  dispatchAbsenceNotificationInBackground(student, log);

  return { log, wasAbsenceOverride: false, duplicate: false };
};

// Registra un evento de asistencia completo.
// El `school` se desnormaliza desde el estudiante (el caller ya validó que
// exista) para acelerar las queries tenant-scoped.
// Devuelve { log, eventType, duplicate, wasAbsenceOverride }.
// `duplicate: true` significa que se reutilizó un log existente y NO se volvió
// a notificar. `wasAbsenceOverride: true` significa que se actualizó un
// absent→late (el alumno llegó tarde después del corte de gracia).
const registerAttendanceEvent = async ({
  student,
  eventTime,
  device,
  verificationMode,
  snapshotUrl = null,
}) => {
  const existing = await findRecentDuplicate(student._id, device, eventTime);
  if (existing) {
    return {
      log: existing,
      eventType: existing.event_type,
      duplicate: true,
      wasAbsenceOverride: false,
    };
  }

  const eventType = await determineNextType(student._id);

  // Para entry events: si el alumno llegó después del corte de gracia,
  // resolver late arrival (puede actualizar un absent→late o crear late normal)
  if (eventType === "entry") {
    const { after } = await isAfterGracePeriod(student, eventTime);
    if (after) {
      const result = await resolveLateArrival({
        student,
        eventTime,
        device,
        verificationMode,
        snapshotUrl,
      });
      return {
        log: result.log,
        eventType: "entry",
        duplicate: result.duplicate,
        wasAbsenceOverride: result.wasAbsenceOverride,
      };
    }
  }

  // Flujo normal: computeEntryStatus para entry, null para exit
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

  return { log, eventType, duplicate: false, wasAbsenceOverride: false };
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

// Marca ausencias automáticas para alumnos sin entry en la fecha dada.
// Para cada turno activo de la escuela, busca alumnos activos que no tengan
// un AttendanceLog entry en esa fecha y les crea un log con status "absent".
// Notifica push a cada tutor individualmente.
// Retorna { marked, skipped, date, shiftsProcessed }.
const markAbsencesForSchool = async (schoolId, schoolYearId, targetDate) => {
  const date = targetDate || new Date();
  const localDate = toLocalDate(date);
  const endOfDay = new Date(localDate.getTime() + 24 * 60 * 60 * 1000);

  // 1. Verificar si es día escolar
  const dayCheck = await isSchoolDay(schoolId, schoolYearId, localDate);
  if (!dayCheck.isSchoolDay) {
    console.log(
      `[attendance][absences] Skipping ${localDate.toISOString().slice(0, 10)} — not a school day (${dayCheck.reason})`
    );
    return {
      marked: 0,
      skipped: 0,
      date: localDate.toISOString().slice(0, 10),
      reason: dayCheck.reason,
      shiftsProcessed: [],
    };
  }

  // 2. Buscar todos los turnos activos
  const shifts = await SchoolShift.find({
    school: schoolId,
    school_year_id: schoolYearId,
    isActive: true,
  })
    .select("shift startTime gracePeriodMinutes name")
    .lean();

  const results = {
    marked: 0,
    skipped: 0,
    date: localDate.toISOString().slice(0, 10),
    shiftsProcessed: [],
  };

  for (const shift of shifts) {
    // 3. Buscar grupos activos de este turno (excluir taller)
    const groups = await Group.find({
      school: schoolId,
      school_year_id: schoolYearId,
      shift: shift.shift,
      isActive: true,
      type: "regular",
    })
      .select("_id")
      .lean();

    if (groups.length === 0) continue;

    const groupIds = groups.map((g) => g._id);

    // 4. Buscar alumnos activos en estos grupos
    const students = await Student.find({
      current_group_id: { $in: groupIds },
      status: "active",
    })
      .select("_id school current_group_id")
      .lean();

    let shiftMarked = 0;
    let shiftSkipped = 0;

    for (const student of students) {
      // 5. Verificar si ya tiene un entry log hoy
      const existingEntry = await AttendanceLog.findOne({
        student_id: student._id,
        event_type: "entry",
        event_time: { $gte: localDate, $lt: endOfDay },
      }).select("_id");

      if (existingEntry) {
        shiftSkipped++;
        continue;
      }

      // 6. Crear log de ausencia
      const absentTime = new Date(localDate);
      const cutoffMinutes = toMinutes(shift.startTime) + (shift.gracePeriodMinutes || 30);
      absentTime.setUTCHours(
        Math.floor(cutoffMinutes / 60),
        cutoffMinutes % 60,
        0,
        0
      );

      const log = await AttendanceLog.create({
        school: student.school,
        student_id: student._id,
        event_time: absentTime,
        event_type: "entry",
        device: "auto@system",
        verificationMode: "MANUAL",
        status: "absent",
      });

      // 7. Notificar push al tutor
      dispatchAbsenceNotificationInBackground(student, log);

      shiftMarked++;
    }

    results.marked += shiftMarked;
    results.skipped += shiftSkipped;
    results.shiftsProcessed.push({
      name: shift.name,
      shift: shift.shift,
      startTime: shift.startTime,
      gracePeriodMinutes: shift.gracePeriodMinutes || 30,
      students: students.length,
      marked: shiftMarked,
      skipped: shiftSkipped,
    });

    console.log(
      `[attendance][absences] Shift ${shift.name}: ${shiftMarked} absent, ${shiftSkipped} already had entry (${students.length} total students)`
    );
  }

  console.log(
    `[attendance][absences] Total for ${results.date}: ${results.marked} marked, ${results.skipped} skipped`
  );

  return results;
};

module.exports = {
  determineNextType,
  findRecentDuplicate,
  invalidateGuardianCaches,
  dispatchNotificationInBackground,
  registerAttendanceEvent,
  registerAbsence,
  computeEntryStatus,
  isSchoolDay,
  isAfterGracePeriod,
  resolveLateArrival,
  markAbsencesForSchool,
};
