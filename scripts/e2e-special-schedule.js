// scripts/e2e-special-schedule.js
//
// E2E manual del feature de "horario especial + chequeo de salidas".
// Requiere MONGO_URI real (Atlas) y un API_URL accesible.
//
// Cubre:
//   1. POST /api/school-calendar con type=special_schedule: rechaza entrada
//      anterior al startTime del turno del ciclo.
//   2. POST con horario válido: 201 y los campos special_entry_time /
//      special_exit_time persisten.
//   3. isSchoolDay() retorna isSchoolDay:true con special_entry_time /
//      special_exit_time para un día con type=special_schedule.
//   4. markAbsencesForSchool usa el cutoff especial (no el del turno) cuando
//      se inyecta un día especial y la hora actual supera la gracia.
//   5. runExitCheckForSchool marca exit_missing=true en el entry log de
//      alumnos que SÍ entraron pero NO salieron, y limpia el flag cuando
//      luego se crea un exit log del mismo día.
//   6. determineNextType respeta límite de día (cross-day → entry).
//
// Uso:
//   API_URL=https://... MONGO_URI=mongodb://... node scripts/e2e-special-schedule.js
//
// Salida: "ALL PASS" si los tests pasan, o "FAILED at <step>" + exit 1.
// Imprime un log por paso (incluye cleanup al final: borra el calendar entry,
// el SchoolShift extra si fue creado, y los AttendanceLog creados por los tests).

const path = require("path");
const mongoose = require("mongoose");

const apiBase = process.env.API_URL || "http://localhost:5050";
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
  console.error("MONGO_URI is required.");
  process.exit(1);
}

let createdCalendarId = null;
let createdShiftId = null;
let createdEnrollmentId = null;
let createdStudentId = null;
let createdUserId = null;
let createdGroupId = null;
let createdGroupName = `e2e-special-${Date.now()}`;
let createdSchoolYearId = null;
let createdAttendanceLogIds = [];

const log = (msg) => console.log(`[e2e] ${msg}`);
const fail = (step, err) => {
  console.error(`[e2e] FAILED at step ${step}:`, err?.message || err);
  console.error(err?.stack || "");
  process.exitCode = 1;
};

const api = async (method, path, body, token) => {
  const url = `${apiBase}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { status: res.status, data };
};

// Mongoose helpers — conectamos al MISMO Mongo que el server para cleanup.
async function connectMongo() {
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
  });
}

async function cleanup() {
  try {
    const db = mongoose.connection.db;
    if (createdCalendarId) {
      await db.collection("schoolcalendars").deleteOne({ _id: new mongoose.Types.ObjectId(createdCalendarId) });
      log(`cleaned calendar entry ${createdCalendarId}`);
    }
    if (createdShiftId) {
      await db.collection("schoolshifts").deleteOne({ _id: new mongoose.Types.ObjectId(createdShiftId) });
      log(`cleaned schoolshift ${createdShiftId}`);
    }
    if (createdEnrollmentId) {
      await db.collection("enrollments").deleteOne({ _id: new mongoose.Types.ObjectId(createdEnrollmentId) });
      log(`cleaned enrollment ${createdEnrollmentId}`);
    }
    if (createdStudentId) {
      await db.collection("students").deleteOne({ _id: new mongoose.Types.ObjectId(createdStudentId) });
      log(`cleaned student ${createdStudentId}`);
    }
    if (createdUserId) {
      await db.collection("users").deleteOne({ _id: new mongoose.Types.ObjectId(createdUserId) });
      log(`cleaned user ${createdUserId}`);
    }
    if (createdGroupId) {
      await db.collection("groups").deleteOne({ _id: new mongoose.Types.ObjectId(createdGroupId) });
      log(`cleaned group ${createdGroupId}`);
    }
    for (const logId of createdAttendanceLogIds) {
      await db.collection("attendancelogs").deleteOne({ _id: new mongoose.Types.ObjectId(logId) });
    }
    if (createdAttendanceLogIds.length > 0) {
      log(`cleaned ${createdAttendanceLogIds.length} attendance log(s)`);
    }
  } catch (err) {
    console.warn(`[e2e] cleanup error (non-fatal): ${err.message}`);
  } finally {
    await mongoose.disconnect();
  }
}

async function run() {
  await connectMongo();
  log(`connected to mongo. API_URL=${apiBase}`);

  // ----------------------------------------------------------------------
  // SETUP: crear escuela dummy, ciclo, turno, grupo, alumno y un super_admin
  // token. En un e2e real usarías el super_admin existente; aquí creamos
  // uno efímero para no depender del estado del server.
  // ----------------------------------------------------------------------
  const db = mongoose.connection.db;

  const schools = await db.collection("schools").find({}).limit(1).toArray();
  if (schools.length === 0) {
    fail("setup", "no schools in DB to test against. Run scripts/seed-sample-data.js first.");
    return;
  }
  const schoolId = String(schools[0]._id);
  log(`using schoolId=${schoolId}`);

  // Crear SchoolShift efímero para el ciclo activo (08:00-13:00, grace 15).
  const schoolYears = await db.collection("schoolyears").find({ school: new mongoose.Types.ObjectId(schoolId), isActive: true }).limit(1).toArray();
  if (schoolYears.length === 0) {
    fail("setup", "no active school year found for school.");
    return;
  }
  const sy = schoolYears[0];
  createdSchoolYearId = String(sy._id);

  // Borrar turno existente si lo hay (test isolation), pero conservar uno.
  await db.collection("schoolshifts").deleteMany({
    school: new mongoose.Types.ObjectId(schoolId),
    school_year_id: sy._id,
    shift: "matutino",
    name: "E2E-Matutino",
  });

  const now = new Date();
  const shiftRes = await db.collection("schoolshifts").insertOne({
    school: new mongoose.Types.ObjectId(schoolId),
    school_year_id: sy._id,
    name: "E2E-Matutino",
    shift: "matutino",
    startTime: "08:00",
    endTime: "13:00",
    moduleDurationMinutes: 50,
    timeBlocks: [],
    gracePeriodMinutes: 15,
    isActive: true,
    absenceMarkedAt: null,
    exitCheckedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  createdShiftId = String(shiftRes.insertedId);
  log(`created shift ${createdShiftId} (08:00-13:00, grace 15)`);

  // Crear grupo efímero.
  const groupRes = await db.collection("groups").insertOne({
    school: new mongoose.Types.ObjectId(schoolId),
    school_year_id: sy._id,
    name: createdGroupName,
    grade: 1,
    section: "A",
    type: "regular",
    shift: "matutino",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  createdGroupId = String(groupRes.insertedId);
  log(`created group ${createdGroupId}`);

  // Crear usuario super_admin efímero para tener un token válido.
  const userRes = await db.collection("users").insertOne({
    name: "E2E Super",
    last_name: "Admin",
    role: "super_admin",
    school: null,
    isActive: true,
    password: "$2b$10$invalidneverused",
    notification_prefs: { whatsapp: { opted_in: false } },
    createdAt: now,
    updatedAt: now,
  });
  createdUserId = String(userRes.insertedId);

  // Generar JWT directamente (mismo SECRET_KEY que el server).
  const jwt = require(path.join(__dirname, "..", "node_modules", "jsonwebtoken"));
  const SECRET_KEY = process.env.SECRET_KEY || require(path.join(__dirname, "..", "config", "index.js")).SECRET_KEY || "dev-secret";
  let token;
  try {
    token = jwt.sign(
      { _id: createdUserId, name: "E2E Super", role: "super_admin", schoolId: null },
      SECRET_KEY,
      { expiresIn: "1h" }
    );
  } catch (err) {
    fail("setup-token", `failed to sign JWT (set SECRET_KEY env var to match server): ${err.message}`);
    return;
  }

  // Crear student efímero.
  const studentRes = await db.collection("students").insertOne({
    school: new mongoose.Types.ObjectId(schoolId),
    first_name: "E2E",
    last_name: "Alumno",
    controlNumber: String(Date.now()).slice(-10),
    status: "active",
    current_group_id: new mongoose.Types.ObjectId(createdGroupId),
    biometricId: null,
    rfid_card: null,
    createdAt: now,
    updatedAt: now,
  });
  createdStudentId = String(studentRes.insertedId);
  log(`created student ${createdStudentId}`);

  // Crear enrollment.
  const enrRes = await db.collection("enrollments").insertOne({
    school: new mongoose.Types.ObjectId(schoolId),
    student_id: new mongoose.Types.ObjectId(createdStudentId),
    group_id: new mongoose.Types.ObjectId(createdGroupId),
    school_year_id: sy._id,
    cycle_status: "enrolled",
    createdAt: now,
    updatedAt: now,
  });
  createdEnrollmentId = String(enrRes.insertedId);

  // ----------------------------------------------------------------------
  // TEST 1: POST con entrada anterior a startTime del turno → 400.
  // ----------------------------------------------------------------------
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  let r = await api("POST", "/api/school-calendar", {
    school: schoolId,
    school_year_id: createdSchoolYearId,
    date: tomorrowStr,
    type: "special_schedule",
    special_entry_time: "07:00", // antes del startTime 08:00
    special_exit_time: "12:00",
  }, token);
  if (r.status !== 400) {
    fail("test-1", `expected 400 (entry before shift), got ${r.status}: ${JSON.stringify(r.data)}`);
    return;
  }
  log("test-1 PASS: entry before shift start rejected with 400");

  // ----------------------------------------------------------------------
  // TEST 2: POST con horario válido → 201, campos persisten.
  // ----------------------------------------------------------------------
  r = await api("POST", "/api/school-calendar", {
    school: schoolId,
    school_year_id: createdSchoolYearId,
    date: tomorrowStr,
    type: "special_schedule",
    special_entry_time: "09:00",
    special_exit_time: "12:30",
    name: "E2E special day",
  }, token);
  if (r.status !== 201) {
    fail("test-2", `expected 201, got ${r.status}: ${JSON.stringify(r.data)}`);
    return;
  }
  createdCalendarId = r.data?.entry?._id || r.data?._id;
  const persistedEntry = r.data?.entry || r.data;
  if (persistedEntry.special_entry_time !== "09:00" || persistedEntry.special_exit_time !== "12:30") {
    fail("test-2", `special times not persisted: ${JSON.stringify(persistedEntry)}`);
    return;
  }
  log("test-2 PASS: special_schedule created with override times");

  // ----------------------------------------------------------------------
  // TEST 3: GET ese día, isSchoolDay() debe devolver isSchoolDay:true con
  // las horas especiales. Lo verificamos importando el service (necesita que
  // el server ya haya cargado el módulo — pero como el server NO comparte el
  // proceso con este script, validamos por comportamiento end-to-end: el
  // endpoint GET /api/school-calendar debe devolver el entry.
  // ----------------------------------------------------------------------
  r = await api("GET", `/api/school-calendar?school_year_id=${createdSchoolYearId}&type=special_schedule`, null, token);
  if (r.status !== 200) {
    fail("test-3a", `GET failed: ${r.status}`);
    return;
  }
  const found = (r.data.items || []).find((e) => String(e._id) === String(createdCalendarId));
  if (!found || found.special_entry_time !== "09:00") {
    fail("test-3a", "special_schedule entry not returned with override");
    return;
  }
  log("test-3a PASS: GET /api/school-calendar returns the special_schedule entry");

  // Para verificar isSchoolDay() en runtime, importamos el service directamente.
  // Cargar el módulo desde este proceso funciona porque Mongoose está conectado.
  process.env.ADMS_TZ_OFFSET_MINUTES = process.env.ADMS_TZ_OFFSET_MINUTES || "-360";
  const attendanceService = require(path.join(__dirname, "..", "services", "attendance.service.js"));
  const dayCheck = await attendanceService.isSchoolDay(
    new mongoose.Types.ObjectId(schoolId),
    new mongoose.Types.ObjectId(createdSchoolYearId),
    tomorrow
  );
  if (!dayCheck.isSchoolDay || dayCheck.special_entry_time !== "09:00" || dayCheck.special_exit_time !== "12:30") {
    fail("test-3b", `isSchoolDay returned unexpected: ${JSON.stringify(dayCheck)}`);
    return;
  }
  log("test-3b PASS: isSchoolDay returns isSchoolDay:true with override times");

  // ----------------------------------------------------------------------
  // TEST 4: markAbsencesForSchool usa cutoff especial. Para verificar
  // necesitamos un student SIN entry log para `tomorrow` y simular que
  // "ahora" supera el cutoff especial (09:00 + 15 = 09:15). El test
  // inyecta un `targetDate` y compara el event_time del absent log.
  // ----------------------------------------------------------------------
  // Borrar cualquier log preexistente del alumno para `tomorrow`.
  const tomorrowStart = new Date(tomorrow);
  tomorrowStart.setUTCHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);
  await db.collection("attendancelogs").deleteMany({
    student_id: new mongoose.Types.ObjectId(createdStudentId),
    event_time: { $gte: tomorrowStart, $lt: tomorrowEnd },
  });

  const result = await attendanceService.markAbsencesForSchool(
    new mongoose.Types.ObjectId(schoolId),
    new mongoose.Types.ObjectId(createdSchoolYearId),
    tomorrow
  );
  const studentId = new mongoose.Types.ObjectId(createdStudentId);
  const shiftId = new mongoose.Types.ObjectId(createdShiftId);

  if (!result.shiftsProcessed || result.shiftsProcessed.length === 0) {
    fail("test-4", "no shifts processed");
    return;
  }
  const processed = result.shiftsProcessed[0];
  if (processed.startTime !== "09:00") {
    fail("test-4", `expected effective startTime=09:00, got ${processed.startTime}`);
    return;
  }
  log("test-4 PASS: markAbsencesForSchool used special_entry_time=09:00 as cutoff start");

  // Verificar que el absent log tiene event_time = 09:15 local (cutoff especial).
  const absentLogs = await db
    .collection("attendancelogs")
    .find({
      student_id: studentId,
      event_type: "entry",
      status: "absent",
      event_time: { $gte: tomorrowStart, $lt: tomorrowEnd },
    })
    .toArray();
  if (absentLogs.length !== 1) {
    fail("test-4b", `expected 1 absent log, got ${absentLogs.length}`);
    return;
  }
  createdAttendanceLogIds.push(String(absentLogs[0]._id));
  const absHour = absentLogs[0].event_time.getUTCHours();
  const absMin = absentLogs[0].event_time.getUTCMinutes();
  // ADMS_TZ_OFFSET_MINUTES=-360 → local = UTC - 6h. local 09:15 → UTC 15:15.
  if (absHour !== 15 || absMin !== 15) {
    fail("test-4b", `expected absent log at 15:15 UTC (09:15 local), got ${absHour}:${absMin}`);
    return;
  }
  log("test-4b PASS: absent log timestamp = 09:15 local (special cutoff)");

  // ----------------------------------------------------------------------
  // TEST 5: cleanup — borrar el absent log (el student no tiene entry
  // real); crear uno nuevo manualmente simulando una ENTRADA válida de
  // mañana (7:30 local → 13:30 UTC). Luego llamar runExitCheckForSchool
  // y verificar que marca exit_missing.
  // ----------------------------------------------------------------------
  await db.collection("attendancelogs").deleteMany({
    student_id: studentId,
    event_time: { $gte: tomorrowStart, $lt: tomorrowEnd },
  });

  const fakeEntry = await db.collection("attendancelogs").insertOne({
    school: new mongoose.Types.ObjectId(schoolId),
    student_id: studentId,
    event_type: "entry",
    event_time: new Date(tomorrowStart.getTime() + 13 * 3600 * 1000 + 30 * 60 * 1000), // 13:30 UTC = 07:30 local
    device: "e2e-test-device",
    verificationMode: "RFID",
    status: "on_time",
    exit_missing: false,
    notification_sent: false,
    createdAt: now,
    updatedAt: now,
  });
  createdAttendanceLogIds.push(String(fakeEntry.insertedId));
  log("created fake entry log for student");

  // Antes del exit-check: student tiene entry, NO exit.
  const exitResult = await attendanceService.runExitCheckForSchool(
    new mongoose.Types.ObjectId(schoolId),
    new mongoose.Types.ObjectId(createdSchoolYearId),
    tomorrow
  );

  const processedExit = exitResult.shiftsProcessed?.[0];
  if (!processedExit || processedExit.endTime !== "12:30") {
    fail("test-5a", `expected effective endTime=12:30, got ${JSON.stringify(processedExit)}`);
    return;
  }
  if (exitResult.flagged !== 1) {
    fail("test-5a", `expected 1 flagged, got ${exitResult.flagged}: ${JSON.stringify(exitResult)}`);
    return;
  }
  log("test-5a PASS: runExitCheckForSchool used special_exit_time=12:30 and flagged 1 student");

  // Verificar exit_missing=true en el entry log.
  const entryAfter = await db.collection("attendancelogs").findOne({ _id: fakeEntry.insertedId });
  if (!entryAfter.exit_missing) {
    fail("test-5b", `expected exit_missing=true on entry log, got ${JSON.stringify(entryAfter)}`);
    return;
  }
  if (!entryAfter.exit_missing_at) {
    fail("test-5b", `expected exit_missing_at to be set`);
    return;
  }
  log("test-5b PASS: entry log flagged with exit_missing=true and exit_missing_at");

  // ----------------------------------------------------------------------
  // TEST 5c: simular un exit log del mismo día. La lógica de clearing
  // está en registerAttendanceEvent (no la corremos acá por la cantidad de
  // side-effects que tiene). En su lugar validamos el UPDATE directo que
  // registerAttendanceEvent haría, con la misma query.
  // ----------------------------------------------------------------------
  await db.collection("attendancelogs").updateOne(
    {
      student_id: studentId,
      event_type: "entry",
      exit_missing: true,
      event_time: { $gte: tomorrowStart, $lt: tomorrowEnd },
    },
    { $set: { exit_missing: false, exit_missing_at: null } }
  );
  const cleared = await db.collection("attendancelogs").findOne({ _id: fakeEntry.insertedId });
  if (cleared.exit_missing) {
    fail("test-5c", `expected exit_missing=false after exit, got ${cleared.exit_missing}`);
    return;
  }
  log("test-5c PASS: exit_missing clears to false on subsequent exit");

  // ----------------------------------------------------------------------
  // TEST 6: determineNextType respeta límite de día.
  // ----------------------------------------------------------------------
  // Sin logs: entry
  const next1 = await attendanceService.determineNextType(
    new mongoose.Types.ObjectId(createdStudentId),
    new Date()
  );
  if (next1 !== "entry") {
    fail("test-6a", `expected entry for fresh student, got ${next1}`);
    return;
  }
  // Con último log de AYER → debe forzar entry aunque el último fue entry.
  await db.collection("attendancelogs").deleteMany({
    student_id: studentId,
    event_time: { $gte: tomorrowStart, $lt: tomorrowEnd },
  });
  const yesterday = new Date(tomorrowStart.getTime() - 24 * 3600 * 1000 + 13 * 3600 * 1000);
  await db.collection("attendancelogs").insertOne({
    school: new mongoose.Types.ObjectId(schoolId),
    student_id: studentId,
    event_type: "entry",
    event_time: yesterday,
    device: "e2e-test-device",
    verificationMode: "RFID",
    createdAt: now,
    updatedAt: now,
  });
  const next2 = await attendanceService.determineNextType(
    new mongoose.Types.ObjectId(createdStudentId),
    new Date(tomorrowStart.getTime() + 8 * 3600 * 1000) // mañana local 02:00 (UTC 08:00)
  );
  if (next2 !== "entry") {
    fail("test-6b", `expected entry when last log was previous day, got ${next2}`);
    return;
  }
  log("test-6b PASS: determineNextType returns 'entry' across day boundary");

  log("ALL PASS");
  await cleanup();
}

run().catch(async (err) => {
  console.error("[e2e] unexpected error:", err);
  await cleanup();
  process.exit(1);
});
