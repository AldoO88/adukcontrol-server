// Servicio de Notificaciones Push (Firebase Cloud Messaging)
// Encapsula el SDK de Firebase Admin para enviar notificaciones push
// a los dispositivos de los tutores cuando se registra un evento de asistencia.
//
// Es seguro llamar a las funciones de este módulo aunque Firebase no esté
// configurado: las funciones simplemente devolverán null o un resultado vacío
// y se imprimirá una advertencia en consola.
const path = require("path"); // Utilidades para manejar rutas de archivos
const fs = require("fs"); // Sistema de archivos
const admin = require("firebase-admin"); // SDK de Firebase Admin

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
// Devuelve { dispatched, failed, tokens } o { dispatched: 0, reason: "..." }.
const sendAttendanceNotification = async (student, attendanceLog) => {
  if (!student || !student.guardians || student.guardians.length === 0) {
    return { dispatched: 0, reason: "no_guardians" };
  }

  // Recolectar tokens FCM únicos y no vacíos
  const tokens = [
    ...new Set(
      student.guardians
        .map((g) => g.fcm_token)
        .filter((t) => typeof t === "string" && t.trim().length > 0)
    ),
  ];

  if (tokens.length === 0) {
    return { dispatched: 0, reason: "no_tokens" };
  }

  // Identificador legible de la escuela para los logs (school puede ser ObjectId o doc populado)
  const schoolTag = student.school
    ? (student.school.cct ? student.school.cct : String(student.school._id || student.school))
    : "no-school";

  const fullName = `${student.first_name} ${student.last_name}`.trim();
  // Etiqueta legible del tipo de evento, en mayúsculas
  const eventTypeLabel =
    attendanceLog.event_type === "entry" ? "ENTRY" : "EXIT";
  const time = new Date(attendanceLog.event_time).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Payload: títulos en inglés, el frontend los traduce antes de mostrar
  const payload = {
    title: `${eventTypeLabel}: ${fullName}`,
    body: `${fullName} marked ${eventTypeLabel.toLowerCase()} at ${time}.`,
    channelId: "eduk_attendance_channel",
    data: {
      event_type: attendanceLog.event_type,
      student_id: String(student._id),
      enrollment_number: student.enrollment_number,
      event_time: String(attendanceLog.event_time),
      log_id: String(attendanceLog._id),
    },
  };

  // Loggear con la CCT/ID de la escuela para distinguir tenants en la consola
  console.log(
    `[attendance][school=${schoolTag}] Dispatching ${eventTypeLabel} for ${fullName} to ${tokens.length} token(s)`
  );

  const result = await sendToTokens(tokens, payload);
  return {
    dispatched: result.successCount,
    failed: result.failureCount,
    tokens: tokens.length,
  };
};

module.exports = {
  initializeFirebase,
  isFirebaseReady,
  sendToTokens,
  sendAttendanceNotification,
};
