// Middleware de autenticación de dispositivo
// Verifica que la petición venga de un dispositivo físico autorizado
// (lector RFID, cámara facial, etc.) usando una API key compartida.
//
// La API key puede llegar en:
//   - Cabecera "X-Device-Api-Key"
//   - Cabecera "X-Api-Key"
//   - Campo "api_key" en el body
//
// La comparación se hace con crypto.timingSafeEqual para evitar timing attacks.
const crypto = require("crypto");

const verifyDeviceApiKey = (req, res, next) => {
  // Secreto configurado en el servidor (variable de entorno)
  const expected = process.env.DEVICE_TRIGGER_API_KEY;

  if (!expected) {
    // El servidor no está configurado para aceptar peticiones de dispositivos
    return res
      .status(500)
      .json({ message: "Device API key is not configured on the server." });
  }

  // Buscar la API key en cabeceras o en el body
  const provided =
    req.headers["x-device-api-key"] ||
    req.headers["x-api-key"] ||
    (req.body && req.body.api_key);

  if (!provided) {
    return res.status(401).json({ message: "Missing device API key header." });
  }

  // Comparación en tiempo constante
  let equal = false;
  try {
    const a = Buffer.from(String(provided), "utf8");
    const b = Buffer.from(String(expected), "utf8");
    if (a.length === b.length) {
      // Solo se puede comparar si las longitudes coinciden
      equal = crypto.timingSafeEqual(a, b);
    }
  } catch (e) {
    equal = false;
  }

  if (!equal) {
    return res.status(401).json({ message: "Invalid device API key." });
  }

  return next();
};

// === Middleware de autenticación ADMS (terminales ZKTeco) ==============
// El firmware de las terminales NO permite añadir cabeceras personalizadas:
// solo se le configura IP, puerto y ruta. Por eso `verifyDeviceApiKey` no
// sirve aquí y la identificación se hace por número de serie (SN), que el
// equipo manda en el query string de todas sus peticiones.
//
// Variables de entorno:
//   ADMS_ALLOWED_SERIALS   — lista separada por comas de números de serie
//                            autorizados. Si NO se define, se acepta
//                            cualquier SN (útil solo en desarrollo; en
//                            producción DEBE definirse).
//   ADMS_DEVICE_SCHOOL_MAP — JSON { "<SN>": "<schoolId>" }. Cuando existe la
//                            entrada, acota la búsqueda del alumno a esa
//                            escuela y elimina la ambigüedad cross-tenant
//                            (los PIN son únicos por escuela, no globalmente).
//
// El SN NO es un secreto: va en claro en el query string. Este middleware es
// una lista blanca, no autenticación fuerte — expón /iclock solo por HTTPS y,
// si se puede, restringido por IP a la red de la escuela.
const parseCsvEnv = (value) =>
  String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

let cachedSchoolMap = null;
const getDeviceSchoolMap = () => {
  if (cachedSchoolMap !== null) return cachedSchoolMap;

  const raw = process.env.ADMS_DEVICE_SCHOOL_MAP;
  if (!raw) {
    cachedSchoolMap = {};
    return cachedSchoolMap;
  }

  try {
    const parsed = JSON.parse(raw);
    cachedSchoolMap = parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error(
      `[adms] ADMS_DEVICE_SCHOOL_MAP is not valid JSON — ignoring it: ${e.message}`
    );
    cachedSchoolMap = {};
  }

  return cachedSchoolMap;
};

const verifyAdmsDevice = (req, res, next) => {
  const serial = String(req.query.SN || req.query.sn || "").trim();

  if (!serial) {
    // Texto plano: el firmware no interpreta JSON.
    return res.type("text/plain").status(401).send("Missing SN");
  }

  const allowed = parseCsvEnv(process.env.ADMS_ALLOWED_SERIALS);
  if (allowed.length > 0 && !allowed.includes(serial)) {
    console.warn(`[adms] Rejected push from unknown serial SN=${serial}`);
    return res.type("text/plain").status(401).send("Unauthorized SN");
  }
  if (allowed.length === 0) {
    console.warn(
      `[adms] ADMS_ALLOWED_SERIALS is not set — accepting SN=${serial} without allowlist.`
    );
  }

  req.deviceSerial = serial;
  // Puede quedar undefined: el controlador entonces busca cross-tenant y
  // descarta el registro si hay más de una coincidencia.
  req.deviceSchoolId = getDeviceSchoolMap()[serial];

  return next();
};

module.exports = { verifyDeviceApiKey, verifyAdmsDevice };
