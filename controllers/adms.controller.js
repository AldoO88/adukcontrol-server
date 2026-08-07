// Controlador ADMS (ZKTeco Push SDK)
// Recibe los registros que las terminales híbridas ZKTeco (tarjeta RFID +
// reconocimiento facial) empujan al servidor. A diferencia de
// /api/attendance/device-trigger, aquí NO controlamos el formato: el firmware
// habla su propio protocolo y espera respuestas en texto plano.
//
// Endpoints del protocolo:
//   GET  /iclock/cdata?SN=..&options=all   → handshake: el equipo pide su config
//   POST /iclock/cdata?SN=..&table=ATTLOG  → push de marcajes (este es el importante)
//   GET  /iclock/getrequest?SN=..          → polling de comandos pendientes
//   POST /iclock/devicecmd?SN=..           → ACK de comandos
//
// Formato de un ATTLOG (líneas separadas por \n, columnas por \t):
//   PIN \t YYYY-MM-DD HH:mm:ss \t Status \t Verify \t WorkCode \t Reserved1 \t Reserved2
//   Ej:  1042 \t 2026-08-04 07:31:55 \t 0 \t 15 \t 0 \t 0 \t 0
//
// También se acepta un body JSON/urlencoded con las claves { Card, PIN,
// User_ID, ... } para los integradores que ponen un middleware delante del
// equipo en vez de apuntarlo directo a este servidor.
//
// REGLAS DE ORO del protocolo:
//   1. Responder SIEMPRE 200 + texto plano. Un 4xx/5xx hace que la terminal
//      reenvíe el lote completo en bucle hasta llenar su buffer.
//   2. Por eso los registros que no casan con ningún alumno se registran en
//      consola y se descartan: se acusan como procesados igual.
const Student = require("../models/Student.model");
const attendanceService = require("../services/attendance.service");

// === Códigos `Verify` del firmware ZKTeco ==============================
// El valor exacto varía entre modelos, por eso agrupamos por familia y
// dejamos un fallback por presencia de campos si el código es desconocido.
//   0 password | 1 huella | 2,4 tarjeta | 15,20..23 rostro | 25 palma
const FACE_VERIFY_CODES = new Set([15, 20, 21, 22, 23]);
const CARD_VERIFY_CODES = new Set([2, 4]);

// Desfase (en minutos) entre la hora local que manda la terminal y UTC.
// El firmware envía "2026-08-04 07:31:55" SIN zona horaria, así que sin este
// dato el servidor lo interpretaría en SU propia zona (típicamente UTC en un
// contenedor), corriendo todos los marcajes varias horas.
// Ej. para México central (UTC-6): ADMS_TZ_OFFSET_MINUTES=-360
const parseTzOffsetMinutes = () => {
  const raw = process.env.ADMS_TZ_OFFSET_MINUTES;
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

// "0", "", "   " y null significan "este campo no viene" en el firmware.
const isBlankField = (value) =>
  value === undefined ||
  value === null ||
  String(value).trim() === "" ||
  String(value).trim() === "0";

const normalizeCard = (raw) =>
  isBlankField(raw) ? null : String(raw).trim().toUpperCase();

// El PIN se conserva tal cual (String): el firmware admite ceros a la
// izquierda y "0042" es un usuario distinto de "42".
const normalizePin = (raw) => (isBlankField(raw) ? null : String(raw).trim());

// Convierte "YYYY-MM-DD HH:mm:ss" (hora local del equipo) a Date.
// Devuelve null si no se puede parsear — el caller usa la hora del servidor.
const parseDeviceTime = (raw) => {
  if (!raw) return null;

  const match = String(raw)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);

  if (!match) {
    // Último recurso: alguna terminal manda ISO 8601 completo.
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const [, y, mo, d, h, mi, s] = match;
  const offsetMinutes = parseTzOffsetMinutes();

  if (offsetMinutes === null) {
    // Sin offset configurado: interpretar en la zona horaria del servidor
    // (correcto cuando el backend corre en la misma zona que la escuela).
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s || 0)
    );
  }

  const asUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s || 0)
  );
  return new Date(asUtc - offsetMinutes * 60 * 1000);
};

// Normaliza un objeto (JSON o urlencoded) a la forma interna de registro.
// Acepta las variantes de nombre que usan los distintos integradores.
const recordFromObject = (obj) => {
  const pick = (...keys) => {
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    }
    return undefined;
  };

  const verifyRaw = pick("Verify", "verify", "VerifyMode", "verify_mode");
  const verifyCode = Number(verifyRaw);

  return {
    pin: normalizePin(pick("PIN", "pin", "User_ID", "UserID", "user_id", "userId")),
    card: normalizeCard(pick("Card", "card", "CardNo", "card_no")),
    eventTime: parseDeviceTime(
      pick("DateTime", "datetime", "time", "event_time", "timestamp")
    ),
    verifyCode: Number.isFinite(verifyCode) ? verifyCode : null,
    snapshotUrl:
      pick("snapshotUrl", "snapshot_url", "SnapshotUrl", "photoUrl") || null,
  };
};

// Parsea una línea ATTLOG tab-separada. Devuelve null si la línea está vacía.
const recordFromAttlogLine = (line) => {
  const cols = line.split("\t").map((c) => c.trim());
  if (cols.length === 0 || cols.every((c) => c === "")) return null;

  const verifyCode = Number(cols[3]);

  return {
    // En un ATTLOG la columna 0 es siempre el PIN (User ID). El número de
    // tarjeta NO viaja en esta tabla: cuando el alumno marca con tarjeta, el
    // equipo resuelve la tarjeta a su PIN interno y reporta el PIN con
    // Verify=4. Por eso `card` queda null y el modo se decide por Verify.
    pin: normalizePin(cols[0]),
    card: null,
    eventTime: parseDeviceTime(cols[1]),
    verifyCode: Number.isFinite(verifyCode) ? verifyCode : null,
    snapshotUrl: null,
  };
};

// Extrae la lista de registros del request, sea cual sea el formato.
const parseRecords = (req) => {
  const body = req.body;

  // (a) Body crudo de texto: el ATTLOG real del firmware.
  if (typeof body === "string" && body.trim() !== "") {
    return body
      .split(/\r?\n/)
      .map(recordFromAttlogLine)
      .filter((r) => r !== null);
  }

  if (!body || typeof body !== "object") return [];

  // (b) Array de registros, o { records: [...] } / { data: [...] }.
  const list = Array.isArray(body)
    ? body
    : Array.isArray(body.records)
      ? body.records
      : Array.isArray(body.data)
        ? body.data
        : null;

  if (list) return list.map(recordFromObject);

  // (c) Objeto plano con un solo registro.
  return [recordFromObject(body)];
};

// Decide el verificationMode del log.
// Prioridad: código Verify del firmware > campo presente en el payload.
// Ojo: la terminal manda el PIN en TODOS los marcajes (también en los de
// tarjeta), así que la presencia de PIN por sí sola no implica rostro.
const resolveVerificationMode = (record) => {
  if (record.verifyCode !== null) {
    if (FACE_VERIFY_CODES.has(record.verifyCode)) return "FACE";
    if (CARD_VERIFY_CODES.has(record.verifyCode)) return "RFID";
  }
  return record.card ? "RFID" : "FACE";
};

// Busca al alumno con la lógica $or pedida: tarjeta RFID, biometricId
// (User ID de la terminal) o número de control.
//
// NOTA MULTI-TENANT: los identificadores son únicos POR ESCUELA, no
// globalmente, y el push ADMS no trae contexto de tenant. Si el mismo PIN
// existe en dos escuelas la coincidencia es ambigua y se descarta el
// registro en vez de adjudicárselo al alumno equivocado. Para evitarlo,
// configura ADMS_DEVICE_SCHOOL_MAP (ver middleware/device.middleware.js) y el
// número de serie del equipo acotará la búsqueda a una sola escuela.
const findStudentForRecord = async (record, schoolId) => {
  const clauses = [];
  if (record.card) clauses.push({ rfid_card: record.card });
  if (record.pin) {
    clauses.push({ biometricId: record.pin });
    clauses.push({ controlNumber: record.pin });
  }

  if (clauses.length === 0) return { student: null, reason: "no_identifier" };

  const filter = { $or: clauses, status: "active" };
  if (schoolId) filter.school = schoolId;

  // limit(2): solo necesitamos saber si hay más de una coincidencia.
  const matches = await Student.find(filter).limit(2);

  if (matches.length === 0) return { student: null, reason: "not_found" };
  if (matches.length > 1) return { student: null, reason: "ambiguous" };
  if (!matches[0].school) return { student: null, reason: "no_school" };

  return { student: matches[0], reason: null };
};

// POST /iclock/cdata?SN=<serie>&table=ATTLOG
// Punto de entrada del push. Procesa el lote completo y siempre responde 200.
const handleZkTecoPush = async (req, res) => {
  const serial = String(req.query.SN || req.query.sn || "unknown");
  const table = String(req.query.table || "ATTLOG").toUpperCase();

  try {
    // El equipo también empuja OPERLOG (eventos de administración) y
    // ATTPHOTO. No los persistimos, pero hay que acusarlos o los reintenta.
    if (table !== "ATTLOG") {
      console.log(`[adms] SN=${serial} table=${table} ignored (not ATTLOG)`);
      return res.type("text/plain").status(200).send("OK");
    }

    const records = parseRecords(req);

    if (records.length === 0) {
      console.warn(`[adms] SN=${serial} push with no parsable records`);
      return res.type("text/plain").status(200).send("OK: 0");
    }

    const device = `zkteco@${serial}`;
    let stored = 0;

    for (const record of records) {
      try {
        const { student, reason } = await findStudentForRecord(
          record,
          req.deviceSchoolId
        );

        if (!student) {
          console.warn(
            `[adms] SN=${serial} unmatched record (${reason}) pin=${record.pin || "-"} card=${record.card || "-"}`
          );
          continue;
        }

        const verificationMode = resolveVerificationMode(record);
        const eventTime = record.eventTime || new Date();

        const { log, eventType, duplicate } =
          await attendanceService.registerAttendanceEvent({
            student,
            eventTime,
            device,
            verificationMode,
            snapshotUrl: record.snapshotUrl,
          });

        if (duplicate) {
          console.log(
            `[adms] SN=${serial} duplicate ignored for student ${student._id} (log ${log._id})`
          );
          continue;
        }

        stored += 1;
        console.log(
          `[adms] SN=${serial} ${eventType} ${verificationMode} student=${student._id} log=${log._id}`
        );
      } catch (recordErr) {
        // Un registro corrupto no debe tirar el lote entero: se descarta.
        console.error(
          `[adms] SN=${serial} error processing record pin=${record.pin || "-"}: ${recordErr.message}`
        );
      }
    }

    // El firmware espera "OK: <n>" en texto plano.
    return res.type("text/plain").status(200).send(`OK: ${stored}`);
  } catch (error) {
    // Ni siquiera aquí devolvemos 5xx: la terminal reintentaría en bucle.
    console.error(`[adms] SN=${serial} fatal push error: ${error.message}`);
    return res.type("text/plain").status(200).send("OK: 0");
  }
};

// GET /iclock/cdata?SN=<serie>&options=all&pushver=2.4.1
// Handshake inicial. La terminal no empieza a empujar marcajes hasta que
// recibe esta configuración en texto plano.
const handleZkTecoHandshake = (req, res) => {
  const serial = String(req.query.SN || req.query.sn || "unknown");
  console.log(`[adms] SN=${serial} handshake`);

  const config = [
    `GET OPTION FROM: ${serial}`,
    "ATTLOGStamp=None", // None = manda todo lo que tenga pendiente
    "OPERLOGStamp=None",
    "ATTPHOTOStamp=None",
    "ErrorDelay=30", // Segundos de espera tras un error
    "Delay=10", // Intervalo de polling de comandos
    "TransTimes=00:00;14:00", // Horas de sincronización forzada
    "TransInterval=1", // Minutos entre envíos
    "TransFlag=1111000000", // Qué tablas transmitir (ATTLOG en primer bit)
    "Realtime=1", // Empujar cada marcaje al instante
    "Encrypt=0",
  ].join("\n");

  return res.type("text/plain").status(200).send(config);
};

// GET /iclock/getrequest?SN=<serie>
// La terminal pregunta si hay comandos pendientes (alta de usuario, borrado,
// carga de plantilla facial...). Hoy no encolamos comandos: "OK" la mantiene
// en línea. Aquí es donde se engancharía el enrolamiento remoto de rostros.
const handleZkTecoGetRequest = (req, res) =>
  res.type("text/plain").status(200).send("OK");

// POST /iclock/devicecmd?SN=<serie>
// ACK de la terminal a un comando previo.
const handleZkTecoDeviceCmd = (req, res) => {
  const serial = String(req.query.SN || req.query.sn || "unknown");
  console.log(`[adms] SN=${serial} devicecmd ack`);
  return res.type("text/plain").status(200).send("OK");
};

module.exports = {
  handleZkTecoPush,
  handleZkTecoHandshake,
  handleZkTecoGetRequest,
  handleZkTecoDeviceCmd,
  // Exportados para pruebas / reutilización
  parseRecords,
  resolveVerificationMode,
  findStudentForRecord,
};
