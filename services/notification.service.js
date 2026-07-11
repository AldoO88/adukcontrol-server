const path = require("path"); // Utilidades de rutas
const fs = require("fs"); // Sistema de archivos
const admin = require("firebase-admin"); // SDK de Firebase Admin

let initialized = false; // Bandera de inicialización

const initializeFirebase = () => { // Inicializar SDK
  if (initialized) { // Ya inicializado
    return admin; // Devolver admin
  }

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH; // Ruta del JSON

  if (!serviceAccountPath) { // No configurado
    console.warn( // Aviso
      "[firebase] FIREBASE_SERVICE_ACCOUNT_PATH is not set. Push notifications will be disabled."
    );
    return null; // Notificaciones deshabilitadas
  }

  const absolutePath = path.isAbsolute(serviceAccountPath) // ¿Es absoluta?
    ? serviceAccountPath
    : path.resolve(process.cwd(), serviceAccountPath); // Resolver relativa

  if (!fs.existsSync(absolutePath)) { // No existe el archivo
    console.warn( // Aviso
      `[firebase] Service account file not found at ${absolutePath}. Push notifications will be disabled.`
    );
    return null; // Notificaciones deshabilitadas
  }

  try {
    const serviceAccount = JSON.parse(fs.readFileSync(absolutePath, "utf8")); // Leer y parsear

    if (!admin.apps.length) { // Sin apps inicializadas
      admin.initializeApp({ // Inicializar
        credential: admin.credential.cert(serviceAccount), // Credenciales
      });
    }

    initialized = true; // Marcar
    console.log("[firebase] Firebase Admin SDK initialized successfully."); // Confirmar
    return admin; // Devolver admin
  } catch (error) { // Error al inicializar
    console.error( // Log
      `[firebase] Failed to initialize Firebase Admin SDK: ${error.message}`
    );
    return null; // Notificaciones deshabilitadas
  }
};

const isFirebaseReady = () => initialized && admin.apps.length > 0; // ¿Listo para enviar?

const sendToTokens = async (tokens, payload) => { // Envío multicast
  if (!Array.isArray(tokens) || tokens.length === 0) { // Sin tokens
    return { successCount: 0, failureCount: 0, responses: [] }; // Nada que hacer
  }

  if (!isFirebaseReady()) { // Firebase no configurado
    console.warn( // Aviso
      "[firebase] Skipping push notification dispatch: Firebase is not configured."
    );
    return { successCount: 0, failureCount: tokens.length, responses: [] }; // Reportar fallos
  }

  const messaging = admin.messaging(); // Servicio de mensajería
  const multicastMessage = { // Mensaje multicast
    tokens, // Tokens destino
    notification: { // Notificación visible
      title: payload.title, // Título
      body: payload.body, // Cuerpo
    },
    data: payload.data // Datos extra (siempre string)
      ? Object.fromEntries(
          Object.entries(payload.data).map(([key, value]) => [
            key,
            String(value), // Forzar string
          ])
        )
      : {},
    android: { // Configuración Android
      priority: "high", // Prioridad alta
      notification: { // Notificación Android
        sound: "default", // Sonido por defecto
        channelId: payload.channelId || "eduk_attendance_channel", // Canal
      },
    },
    apns: { // Configuración iOS
      headers: { "apns-priority": "10" }, // Prioridad APNs
      payload: { // Payload APNs
        aps: { sound: "default", "content-available": 1 }, // Sonido + background
      },
    },
  };

  try {
    const response = await messaging.sendEachForMulticast(multicastMessage); // Enviar
    return { // Devolver resultados
      successCount: response.successCount, // Exitosos
      failureCount: response.failureCount, // Fallidos
      responses: response.responses, // Detalle por token
    };
  } catch (error) { // Error en el envío
    console.error( // Log
      `[firebase] Error sending push notifications: ${error.message}`
    );
    throw error; // Propagar
  }
};

const sendAttendanceNotification = async (student, attendanceLog) => { // Notificar tutores
  if (!student || !student.tutores || student.tutores.length === 0) { // Sin tutores
    return { dispatched: 0, reason: "no_tutors" }; // Nada que enviar
  }

  const tokens = [ // Tokens únicos y no vacíos
    ...new Set(
      student.tutores
        .map((t) => t.fcmToken)
        .filter((t) => typeof t === "string" && t.trim().length > 0)
    ),
  ];

  if (tokens.length === 0) { // No hay tokens válidos
    return { dispatched: 0, reason: "no_tokens" }; // Nada que enviar
  }

  const fullName = `${student.name} ${student.apellidos}`.trim(); // Nombre completo
  const tipoLabel = // Etiqueta mayúscula
    attendanceLog.tipo === "entrada" ? "ENTRADA" : "SALIDA";
  const time = new Date(attendanceLog.fecha_hora).toLocaleTimeString("es-MX", { // Hora local MX
    hour: "2-digit", // Hora con 2 dígitos
    minute: "2-digit", // Minuto con 2 dígitos
  });

  const payload = { // Carga útil
    title: `Registro de ${tipoLabel}: ${fullName}`, // Título
    body: `Se registró ${tipoLabel.toLowerCase()} a las ${time}.`, // Cuerpo
    channelId: "eduk_attendance_channel", // Canal
    data: { // Datos adicionales
      tipo: attendanceLog.tipo, // Tipo de evento
      student_id: String(student._id), // ID del estudiante
      matricula: student.matricula, // Matrícula
      fecha_hora: String(attendanceLog.fecha_hora), // Momento
      log_id: String(attendanceLog._id), // ID del registro
    },
  };

  const result = await sendToTokens(tokens, payload); // Enviar a todos
  return { // Resumen
    dispatched: result.successCount, // Enviados
    failed: result.failureCount, // Fallidos
    tokens: tokens.length, // Total de tokens
  };
};

module.exports = { // Exportar
  initializeFirebase,
  isFirebaseReady,
  sendToTokens,
  sendAttendanceNotification,
};
