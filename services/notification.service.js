// Servicio de Notificaciones Push (Firebase Cloud Messaging)
// Encapsula el SDK de Firebase Admin para enviar notificaciones push
// a los dispositivos de los tutores cuando se registra un evento de
// asistencia, se publica un aviso, o se agenda un citatorio.
//
// Es seguro llamar a las funciones de este módulo aunque Firebase no esté
// configurado: las funciones simplemente devolverán null o un resultado vacío
// y se imprimirá una advertencia en consola.
const path = require("path"); // Utilidades para manejar rutas de archivos
const fs = require("fs"); // Sistema de archivos
const admin = require("firebase-admin"); // SDK de Firebase Admin
const Guardian = require("../models/Guardian.model"); // Modelo de tutores
const Student = require("../models/Student.model"); // Modelo de estudiantes
const User = require("../models/User.model"); // Modelo de usuarios (para notificaciones a staff)

// Bandera: true después de inicializar Firebase correctamente
let initialized = false;

// Inicializa el SDK de Firebase Admin usando la ruta al JSON de la cuenta de servicio
// indicada por la variable de entorno FIREBASE_SERVICE_ACCOUNT_PATH.
// Devuelve el admin inicializado o null si no se pudo inicializar.
const initializeFirebase = () => {
  if (initialized) {
    return admin;
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!serviceAccountPath) {
    console.warn(
      "[firebase] FIREBASE_SERVICE_ACCOUNT_PATH is not set. Push notifications will be disabled."
    );
    return null;
  }

  // Aceptar tanto rutas absolutas como relativas al cwd
  const absolutePath = path.isAbsolute(serviceAccountPath)
    ? serviceAccountPath
    : path.resolve(process.cwd(), serviceAccountPath);

  if (!fs.existsSync(absolutePath)) {
    console.warn(
      `[firebase] Service account file not found at ${absolutePath}. Push notifications will be disabled.`
    );
    return null;
  }

  try {
    const serviceAccount = JSON.parse(fs.readFileSync(absolutePath, "utf8"));

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    initialized = true;
    console.log("[firebase] Firebase Admin SDK initialized successfully.");
    return admin;
  } catch (error) {
    console.error(
      `[firebase] Failed to initialize Firebase Admin SDK: ${error.message}`
    );
    return null;
  }
};

// Helper: ¿está Firebase listo para enviar mensajes?
const isFirebaseReady = () => initialized && admin.apps.length > 0;

// Envía un mensaje multicast a una lista de tokens FCM.
// Devuelve { successCount, failureCount, responses }.
const sendToTokens = async (tokens, payload) => {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, responses: [] };
  }

  if (!isFirebaseReady()) {
    console.warn(
      "[firebase] Skipping push notification dispatch: Firebase is not configured."
    );
    return { successCount: 0, failureCount: tokens.length, responses: [] };
  }

  const messaging = admin.messaging();
  const multicastMessage = {
    tokens, // Lista de tokens destino
    notification: {
      title: payload.title, // Título visible
      body: payload.body, // Cuerpo visible
    },
    // FCM exige que los valores en "data" sean strings
    data: payload.data
      ? Object.fromEntries(
          Object.entries(payload.data).map(([key, value]) => [
            key,
            String(value),
          ])
        )
      : {},
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channelId: payload.channelId || "eduk_attendance_channel",
      },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: {
        aps: { sound: "default", "content-available": 1 },
      },
    },
  };

  try {
    const response = await messaging.sendEachForMulticast(multicastMessage);
    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses,
    };
  } catch (error) {
    console.error(
      `[firebase] Error sending push notifications: ${error.message}`
    );
    throw error;
  }
};

// Notifica a los tutores de un estudiante sobre un evento de asistencia recién creado.
// Devuelve { dispatched, failed, tokens, invalidated } o { dispatched: 0, reason: "..." }.
const sendAttendanceNotification = async (student, attendanceLog) => {
  // Buscar los tutores del estudiante en la colección Guardian
  // (single source of truth tras la refactorización)
  const guardians = await Guardian.find({
    students: student._id,
    school: student.school,
  }).select("fcm_token phone name");

  if (!guardians || guardians.length === 0) {
    return { dispatched: 0, reason: "no_guardians" };
  }

  // Construir mapa token → guardian_id para poder invalidar tokens
  // obsoletos cuando Firebase los rechace.
  const tokenToGuardian = new Map();
  for (const g of guardians) {
    if (typeof g.fcm_token === "string" && g.fcm_token.trim().length > 0) {
      tokenToGuardian.set(g.fcm_token, g._id);
    }
  }

  const tokens = [...tokenToGuardian.keys()];
  if (tokens.length === 0) {
    return { dispatched: 0, reason: "no_tokens" };
  }

  // Identificador legible de la escuela para los logs
  const schoolTag = student.school
    ? (student.school.cct ? student.school.cct : String(student.school._id || student.school))
    : "no-school";

  const fullName = `${student.first_name} ${student.last_name}`.trim();
  const eventTypeLabel =
    attendanceLog.event_type === "entry" ? "ENTRY" : "EXIT";
  const time = new Date(attendanceLog.event_time).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const payload = {
    title: `${eventTypeLabel}: ${fullName}`,
    body: `${fullName} marked ${eventTypeLabel.toLowerCase()} at ${time}.`,
    channelId: "eduk_attendance_channel",
    data: {
      event_type: attendanceLog.event_type,
      student_id: String(student._id),
      controlNumber: student.controlNumber,
      event_time: String(attendanceLog.event_time),
      log_id: String(attendanceLog._id),
    },
  };

  console.log(
    `[attendance][school=${schoolTag}] Dispatching ${eventTypeLabel} for ${fullName} to ${tokens.length} token(s)`
  );

  const result = await sendToTokens(tokens, payload);

  // Invalidar tokens rechazados por Firebase: si llegan con error de
  // "no registrado" o "inválido", los marcamos como null en la DB para no
  // seguir mandándoles push. La app móvil tendrá que re-registrar el token
  // (o el usuario desinstaló la app).
  const invalidTokenGuardianIds = [];
  if (result.responses && Array.isArray(result.responses)) {
    result.responses.forEach((resp, idx) => {
      if (resp.success || !resp.error) return;
      const code = resp.error.code || "";
      const isStale =
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument";
      if (!isStale) return;
      const failedToken = tokens[idx];
      const guardianId = tokenToGuardian.get(failedToken);
      if (guardianId) invalidTokenGuardianIds.push(guardianId);
    });
  }

  let invalidated = 0;
  if (invalidTokenGuardianIds.length > 0) {
    const upd = await Guardian.updateMany(
      { _id: { $in: invalidTokenGuardianIds } },
      { $set: { fcm_token: null } }
    );
    invalidated = upd.modifiedCount;
    console.log(
      `[attendance][school=${schoolTag}] Invalidated ${invalidated} stale fcm_token(s) (will require mobile app to re-register)`
    );
  }

  return {
    dispatched: result.successCount,
    failed: result.failureCount,
    tokens: tokens.length,
    invalidated,
  };
};

// Helper compartido: arma el tokenToGuardian map, despacha y limpia
// tokens stale. Lo usan las 3 funciones de notificación (attendance,
// citation, announcement) para no duplicar el patrón de invalidación.
const dispatchToGuardians = async (guardians, payload, logTag) => {
  if (!guardians || guardians.length === 0) {
    return { dispatched: 0, reason: "no_guardians" };
  }
  const tokenToGuardian = new Map();
  for (const g of guardians) {
    if (typeof g.fcm_token === "string" && g.fcm_token.trim().length > 0) {
      tokenToGuardian.set(g.fcm_token, g._id);
    }
  }
  const tokens = [...tokenToGuardian.keys()];
  if (tokens.length === 0) {
    return { dispatched: 0, reason: "no_tokens" };
  }

  const result = await sendToTokens(tokens, payload);

  // Invalidar tokens stale (registration-token-not-registered, etc.)
  const invalidTokenGuardianIds = [];
  if (result.responses && Array.isArray(result.responses)) {
    result.responses.forEach((resp, idx) => {
      if (resp.success || !resp.error) return;
      const code = resp.error.code || "";
      const isStale =
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument";
      if (!isStale) return;
      const failedToken = tokens[idx];
      const guardianId = tokenToGuardian.get(failedToken);
      if (guardianId) invalidTokenGuardianIds.push(guardianId);
    });
  }

  let invalidated = 0;
  if (invalidTokenGuardianIds.length > 0) {
    const upd = await Guardian.updateMany(
      { _id: { $in: invalidTokenGuardianIds } },
      { $set: { fcm_token: null } }
    );
    invalidated = upd.modifiedCount;
    console.log(
      `[${logTag}] Invalidated ${invalidated} stale fcm_token(s)`
    );
  }

  return {
    dispatched: result.successCount,
    failed: result.failureCount,
    tokens: tokens.length,
    invalidated,
  };
};

// Notifica a los tutores de un estudiante sobre un citatorio recién creado
// (o cuyo status cambió). `citation` debe traer el `student` populado.
// Devuelve { dispatched, failed, tokens, invalidated } o { dispatched: 0, reason: "..." }.
const sendCitationNotification = async (citation) => {
  const studentId = citation.student?._id || citation.student;
  const studentName = citation.student
    ? `${citation.student.first_name || ""} ${citation.student.last_name || ""}`.trim()
    : "Alumno";

  const guardians = await Guardian.find({
    students: studentId,
    school: citation.school,
  }).select("fcm_token phone name").lean();

  if (!guardians || guardians.length === 0) {
    return { dispatched: 0, reason: "no_guardians" };
  }

  const dateStr = new Date(citation.scheduledDate).toLocaleString("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const typeLabel =
    citation.type === "academic"
      ? "Académico"
      : citation.type === "behavioral"
      ? "Conducta"
      : "Administrativo";

  const payload = {
    title: `Citatorio: ${studentName}`,
    body: `${typeLabel} - ${dateStr}. ${citation.reason}${
      citation.location ? ` · Lugar: ${citation.location}` : ""
    }`,
    channelId: "eduk_citations_channel",
    data: {
      kind: "citation",
      citation_id: String(citation._id),
      student_id: String(studentId),
      scheduledDate: String(citation.scheduledDate),
      type: citation.type,
      status: citation.status,
    },
  };

  console.log(
    `[citations] Dispatching citatorio for ${studentName} to ${guardians.length} guardian(s)`
  );
  return dispatchToGuardians(guardians, payload, "citations");
};

// Notifica a los tutores afectados por un aviso recién creado.
// Determina los destinatarios según el targetType del aviso:
//   - "general" → todos los estudiantes activos de la escuela
//   - "group"   → estudiantes cuyo current_group_id está en targetGroups
//   - "student" → estudiantes en targetStudents
// Devuelve { dispatched, failed, tokens, invalidated } o { dispatched: 0, reason: "..." }.
const sendAnnouncementNotification = async (announcement) => {
  // 1) Resolver los studentIds destinatarios.
  let studentIds = [];
  const targetGroupsIds = (announcement.targetGroups || []).map((g) =>
    typeof g === "object" ? String(g._id || g) : String(g)
  );
  const targetStudentsIds = (announcement.targetStudents || []).map((s) =>
    typeof s === "object" ? String(s._id || s) : String(s)
  );

  if (announcement.targetType === "general") {
    const students = await Student.find({
      school: announcement.school,
      status: "active",
    })
      .select("_id")
      .lean();
    studentIds = students.map((s) => s._id);
  } else if (announcement.targetType === "group") {
    if (targetGroupsIds.length === 0) {
      return { dispatched: 0, reason: "no_groups" };
    }
    const students = await Student.find({
      school: announcement.school,
      current_group_id: { $in: targetGroupsIds },
      status: "active",
    })
      .select("_id")
      .lean();
    studentIds = students.map((s) => s._id);
  } else if (announcement.targetType === "student") {
    studentIds = targetStudentsIds;
  }

  if (studentIds.length === 0) {
    return { dispatched: 0, reason: "no_students" };
  }

  // 2) Tutores de esos estudiantes.
  const guardians = await Guardian.find({
    school: announcement.school,
    students: { $in: studentIds },
  })
    .select("fcm_token phone name")
    .lean();

  if (!guardians || guardians.length === 0) {
    return { dispatched: 0, reason: "no_guardians" };
  }

  // 3) Truncar el mensaje para que entre en el push (Android limita a ~240).
  const truncated =
    announcement.message && announcement.message.length > 180
      ? `${announcement.message.slice(0, 177)}...`
      : announcement.message || "";

  const priorityPrefix =
    announcement.priority === "urgent" ? "🚨 Urgente: " : "";
  const title = `${priorityPrefix}${announcement.title}`;

  const payload = {
    title,
    body: truncated,
    channelId: "eduk_announcements_channel",
    data: {
      kind: "announcement",
      announcement_id: String(announcement._id),
      targetType: announcement.targetType,
      priority: announcement.priority,
    },
  };

  console.log(
    `[announcements] Dispatching "${announcement.title}" (${announcement.targetType}) to ${guardians.length} guardian(s) of ${studentIds.length} student(s)`
  );
  return dispatchToGuardians(guardians, payload, "announcements");
};

// Notifica a los tutores de un estudiante sobre una ausencia marcada
// automáticamente por el cronjob o manualmente por el admin.
// Devuelve { dispatched, failed, tokens, invalidated } o { dispatched: 0, reason: "..." }.
const sendAbsenceNotification = async (student, attendanceLog) => {
  const guardians = await Guardian.find({
    students: student._id,
    school: student.school,
  }).select("fcm_token phone name");

  if (!guardians || guardians.length === 0) {
    return { dispatched: 0, reason: "no_guardians" };
  }

  const fullName = `${student.first_name} ${student.last_name}`.trim();
  const time = new Date(attendanceLog.event_time).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const statusLabel =
    attendanceLog.status === "absent" ? "AUSENCIA" : "RETARDO";
  const bodySuffix =
    attendanceLog.status === "absent"
      ? `fue marcado ausente a las ${time}.`
      : `llegó tarde a las ${time}.`;

  const payload = {
    title: `${statusLabel}: ${fullName}`,
    body: `${fullName} ${bodySuffix}`,
    channelId: "eduk_attendance_channel",
    data: {
      kind: "absence",
      event_type: attendanceLog.event_type,
      status: attendanceLog.status,
      student_id: String(student._id),
      controlNumber: student.controlNumber,
      event_time: String(attendanceLog.event_time),
      log_id: String(attendanceLog._id),
    },
  };

  const schoolTag = student.school
    ? student.school.cct || String(student.school._id || student.school)
    : "no-school";

  console.log(
    `[attendance][school=${schoolTag}] Dispatching ${statusLabel} for ${fullName} to ${guardians.length} guardian(s)`
  );

  return dispatchToGuardians(guardians, payload, "attendance");
};

// Notifica a los tutores de un estudiante sobre un citatorio reagendado.
// `citation` debe traer el `student` populado.
// Devuelve { dispatched, failed, tokens, invalidated } o { dispatched: 0, reason: "..." }.
const sendCitationRescheduledNotification = async (citation) => {
  const studentId = citation.student?._id || citation.student;
  const studentName = citation.student
    ? `${citation.student.first_name || ""} ${citation.student.last_name || ""}`.trim()
    : "Alumno";

  const guardians = await Guardian.find({
    students: studentId,
    school: citation.school,
  }).select("fcm_token phone name").lean();

  if (!guardians || guardians.length === 0) {
    return { dispatched: 0, reason: "no_guardians" };
  }

  const dateStr = new Date(citation.scheduledDate).toLocaleString("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const payload = {
    title: `Citatorio reagendado: ${studentName}`,
    body: `Nueva fecha: ${dateStr}. Lugar: ${citation.location || "No especificado"}`,
    channelId: "eduk_citations_channel",
    data: {
      kind: "citation_rescheduled",
      citation_id: String(citation._id),
      student_id: String(studentId),
      scheduledDate: String(citation.scheduledDate),
      type: citation.type,
      status: citation.status,
    },
  };

  console.log(
    `[citations] Dispatching reschedule notification for ${studentName} to ${guardians.length} guardian(s)`
  );
  return dispatchToGuardians(guardians, payload, "citations");
};

// Notifica a los tutores de un estudiante sobre un citatorio cancelado.
// `citation` debe traer el `student` populado.
// Devuelve { dispatched, failed, tokens, invalidated } o { dispatched: 0, reason: "..." }.
const sendCitationCancelledNotification = async (citation) => {
  const studentId = citation.student?._id || citation.student;
  const studentName = citation.student
    ? `${citation.student.first_name || ""} ${citation.student.last_name || ""}`.trim()
    : "Alumno";

  const guardians = await Guardian.find({
    students: studentId,
    school: citation.school,
  }).select("fcm_token phone name").lean();

  if (!guardians || guardians.length === 0) {
    return { dispatched: 0, reason: "no_guardians" };
  }

  const dateStr = new Date(citation.scheduledDate).toLocaleString("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const payload = {
    title: `Citatorio cancelado: ${studentName}`,
    body: `La cita del ${dateStr} ha sido cancelada.`,
    channelId: "eduk_citations_channel",
    data: {
      kind: "citation_cancelled",
      citation_id: String(citation._id),
      student_id: String(studentId),
      scheduledDate: String(citation.scheduledDate),
      type: citation.type,
      status: citation.status,
    },
  };

  console.log(
    `[citations] Dispatching cancel notification for ${studentName} to ${guardians.length} guardian(s)`
  );
  return dispatchToGuardians(guardians, payload, "citations");
};

// =====================================================================
// Notificaciones al STAFF (teacher/admin) cuando un tutor actuó sobre un citatorio
// =====================================================================

// Helper interno: envía un push a un solo staff user por su fcm_token.
// Devuelve { dispatched: 1|0, reason?: string }.
const sendToStaffUser = async (user, payload) => {
  if (!user || !user.fcm_token) {
    return { dispatched: 0, reason: "no_fcm_token" };
  }

  try {
    await sendToTokens([user.fcm_token], payload);
    return { dispatched: 1 };
  } catch (err) {
    console.error(
      `[notifications] Error sending to staff ${user._id}: ${err.message}`
    );
    return { dispatched: 0, reason: err.message };
  }
};

// Notifica al staff creator que un tutor confirmó un citatorio.
// `citation` debe traer el student populado. `guardianName` es el nombre del tutor.
const sendCitationConfirmedNotification = async (citation, guardianName) => {
  const studentName = citation.student
    ? `${citation.student.first_name || ""} ${citation.student.last_name || ""}`.trim()
    : "Alumno";

  // Buscar al creator (staff) para obtener su fcm_token
  const creator = await User.findById(citation.creator)
    .select("fcm_token name last_name")
    .lean();

  if (!creator) {
    return { dispatched: 0, reason: "creator_not_found" };
  }

  const dateStr = new Date(citation.scheduledDate).toLocaleString("es-MX", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const payload = {
    title: `Citatorio confirmado: ${studentName}`,
    body: `${guardianName} confirmó asistencia para ${dateStr}.`,
    channelId: "eduk_citations_channel",
    data: {
      kind: "citation_confirmed",
      citation_id: String(citation._id),
      student_id: String(citation.student?._id || citation.student),
      scheduledDate: String(citation.scheduledDate),
      status: "confirmed",
    },
  };

  console.log(
    `[citations] Dispatching confirmed notification for citation ${citation._id} to staff ${creator._id}`
  );
  return sendToStaffUser(creator, payload);
};

// Notifica al staff creator que un tutor solicita reagendar un citatorio.
// `citation` debe traer el student populado. `guardianName` es el nombre del tutor.
const sendCitationRescheduleRequestNotification = async (citation, guardianName, reason) => {
  const studentName = citation.student
    ? `${citation.student.first_name || ""} ${citation.student.last_name || ""}`.trim()
    : "Alumno";

  // Buscar al creator (staff) para obtener su fcm_token
  const creator = await User.findById(citation.creator)
    .select("fcm_token name last_name")
    .lean();

  if (!creator) {
    return { dispatched: 0, reason: "creator_not_found" };
  }

  const payload = {
    title: `Solicitud de reagendación`,
    body: `${guardianName} solicita reagendar cita de ${studentName}. Razón: ${reason}`,
    channelId: "eduk_citations_channel",
    data: {
      kind: "citation_reschedule_request",
      citation_id: String(citation._id),
      student_id: String(citation.student?._id || citation.student),
      scheduledDate: String(citation.scheduledDate),
      reason: reason,
    },
  };

  console.log(
    `[citations] Dispatching reschedule request notification for citation ${citation._id} to staff ${creator._id}`
  );
  return sendToStaffUser(creator, payload);
};

module.exports = {
  initializeFirebase,
  isFirebaseReady,
  sendToTokens,
  sendAttendanceNotification,
  sendAbsenceNotification,
  sendCitationNotification,
  sendCitationRescheduledNotification,
  sendCitationCancelledNotification,
  sendCitationConfirmedNotification,
  sendCitationRescheduleRequestNotification,
  sendAnnouncementNotification,
};
