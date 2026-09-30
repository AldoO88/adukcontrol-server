// scripts/smoke-special-schedule.js
//
// Smoke test LOCAL (sin servidor, sin JWT) del feature de horario especial
// y chequeo de salidas. Usa la base de datos local (127.0.0.1:27017/eduk_control)
// o la que indique MONGO_URI. Crea escuelas/shifts/grupos/students efímeros
// con prefijo "smoke-spec-" para poder limpiarlos al final.
//
// Cubre:
//   - isSchoolDay: special_schedule → isSchoolDay=true con horas especiales
//   - markAbsencesForSchool: usa cutoff especial cuando el día lo tiene
//   - runExitCheckForSchool: marca exit_missing=true en entry sin exit
//   - clear on exit: registerAttendanceEvent limpia exit_missing al crear exit
//   - determineNextType: cross-day → entry
//
// Uso:
//   MONGO_URI=mongodb://127.0.0.1:27017/eduk_control node scripts/smoke-special-schedule.js
//
// Salida: "ALL PASS" + cleanup automático.

const path = require("path");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/eduk_control";

const log = (msg) => console.log(`[smoke] ${msg}`);
const fail = (step, err) => {
  console.error(`[smoke] FAILED at step ${step}:`, err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
};

const created = { schools: [], shifts: [], groups: [], students: [], logs: [], calendarEntries: [], enrollments: [] };

async function cleanup() {
  const db = mongoose.connection.db;
  try {
    for (const id of created.calendarEntries) await db.collection("schoolcalendars").deleteOne({ _id: id });
    for (const id of created.enrollments) await db.collection("enrollments").deleteOne({ _id: id });
    for (const id of created.students) await db.collection("students").deleteOne({ _id: id });
    for (const id of created.groups) await db.collection("groups").deleteOne({ _id: id });
    for (const id of created.shifts) await db.collection("schoolshifts").deleteOne({ _id: id });
    for (const id of created.schools) await db.collection("schools").deleteOne({ _id: id });
    for (const id of created.logs) await db.collection("attendancelogs").deleteOne({ _id: id });
    log(`cleaned ${created.schools.length + created.shifts.length + created.groups.length + created.students.length + created.enrollments.length + created.calendarEntries.length + created.logs.length} docs`);
  } catch (err) {
    console.warn(`[smoke] cleanup error (non-fatal): ${err.message}`);
  }
}

async function run() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  log(`connected to ${mongoUri}`);
  process.env.ADMS_TZ_OFFSET_MINUTES = process.env.ADMS_TZ_OFFSET_MINUTES || "-360";

  const db = mongoose.connection.db;
  const now = new Date();

  // Crear escuela dummy (no necesitamos school_year_id complejo; creamos un
  // SchoolShift directo referenciando un ObjectId cualquiera de school_year).
  const schoolRes = await db.collection("schools").insertOne({
    name: "Smoke-Special-School",
    cct: `SMOKE${Date.now()}`.slice(-10),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const schoolId = schoolRes.insertedId;
  created.schools.push(schoolId);
  log(`created school ${schoolId}`);

  // SchoolYear dummy — debe ser ObjectId real pero cualquier valor sirve en
  // términos de schema (no hay FK enforced).
  const fakeSY = new mongoose.Types.ObjectId();

  // SchoolShift: 08:00-13:00, grace 15. Marcamos para E2E.
  const shiftRes = await db.collection("schoolshifts").insertOne({
    school: schoolId,
    school_year_id: fakeSY,
    name: "Smoke-Spec-Matutino",
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
  const shiftId = shiftRes.insertedId;
  created.shifts.push(shiftId);

  // Group dummy.
  const groupRes = await db.collection("groups").insertOne({
    school: schoolId,
    school_year_id: fakeSY,
    name: "Smoke-Spec-Group",
    grade: 1,
    section: "A",
    type: "regular",
    shift: "matutino",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const groupId = groupRes.insertedId;
  created.groups.push(groupId);

  // Student dummy.
  const studentRes = await db.collection("students").insertOne({
    school: schoolId,
    first_name: "Smoke",
    last_name: "Student",
    controlNumber: `99${Date.now()}`.slice(-10),
    status: "active",
    current_group_id: groupId,
    createdAt: now,
    updatedAt: now,
  });
  const studentId = studentRes.insertedId;
  created.students.push(studentId);

  // Enrollment dummy (no usado por markAbsences en realidad, pero buena higiene).
  await db.collection("enrollments").insertOne({
    school: schoolId,
    student_id: studentId,
    group_id: groupId,
    school_year_id: fakeSY,
    cycle_status: "enrolled",
    createdAt: now,
    updatedAt: now,
  });

  const attendanceService = require(path.join(__dirname, "..", "services", "attendance.service.js"));

  // ----------------------------------------------------------------------
  // TEST 1: isSchoolDay con type=special_schedule → isSchoolDay=true con horas.
  // ----------------------------------------------------------------------
  // Insertar un calendar entry para "mañana local" con horario especial.
  // Para evitar líos con toLocalDate (que resta ADMS_TZ_OFFSET_MINUTES),
  // construimos `tomorrow` como UTC 06:00 (= local 00:00 en México) y
  // luego extraemos su Y/M/D local para insertar el calendar entry.
  const ADMS_TZ_OFFSET_MINUTES = parseInt(process.env.ADMS_TZ_OFFSET_MINUTES || "-360", 10);
  const utcOffsetMs = ADMS_TZ_OFFSET_MINUTES * 60000;

  // "mañana" en hora local: today + 24h.
  const nowLocal = new Date(Date.now() + utcOffsetMs);
  const tomorrowLocal = new Date(nowLocal);
  tomorrowLocal.setUTCDate(tomorrowLocal.getUTCDate() + 1);
  tomorrowLocal.setUTCHours(0, 0, 0, 0);
  const tomorrowLocalKey = tomorrowLocal.toISOString().slice(0, 10);

  // Para pasarlo a markAbsencesForSchool necesitamos un Date UTC que, al
  // aplicarle toLocalDate, dé mañana local.
  const tomorrow = new Date(tomorrowLocal.getTime() - utcOffsetMs);
  // toLocalDate(tomorrow) = Date.UTC(year(tomorrow - offset), ...)
  // = tomorrowLocal = tomorrow's local midnight.

  const calendarRes = await db.collection("schoolcalendars").insertOne({
    school: schoolId,
    school_year_id: fakeSY,
    // isSchoolDay normaliza con `setUTCHours(0,0,0,0)` sobre el argumento que
    // recibe (que aquí es `tomorrow` = tomorrowLocal + 6h). Esa normalización
    // cae al inicio del día UTC de `tomorrow`, que es exactamente tomorrowLocal.
    // Por eso guardamos `date: tomorrowLocal` para que la query matchee.
    date: tomorrowLocal,
    type: "special_schedule",
    name: "Smoke special",
    special_entry_time: "09:00",
    special_exit_time: "12:30",
    is_active: true,
    createdAt: now,
    updatedAt: now,
  });
  created.calendarEntries.push(calendarRes.insertedId);

  const dayCheck = await attendanceService.isSchoolDay(schoolId, fakeSY, tomorrow);
  if (!dayCheck.isSchoolDay || dayCheck.special_entry_time !== "09:00" || dayCheck.special_exit_time !== "12:30") {
    fail("test-1", `isSchoolDay returned ${JSON.stringify(dayCheck)}`);
    return;
  }
  log("test-1 PASS: isSchoolDay returns isSchoolDay:true with override times");

  // ----------------------------------------------------------------------
  // TEST 2: markAbsencesForSchool usa cutoff especial (09:00 + 15 = 09:15).
  // Esperaríamos absent log con event_time = 09:15 local = 15:15 UTC.
  // ----------------------------------------------------------------------
  const tomorrowEnd = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
  await db.collection("attendancelogs").deleteMany({
    student_id: studentId,
    event_time: { $gte: tomorrow, $lt: tomorrowEnd },
  });

  const result = await attendanceService.markAbsencesForSchool(schoolId, fakeSY, tomorrow);
  const processed = result.shiftsProcessed[0];
  if (!processed || processed.startTime !== "09:00") {
    fail("test-2a", `expected effective startTime=09:00, got ${JSON.stringify(processed)}`);
    return;
  }
  log("test-2a PASS: markAbsencesForSchool used effective startTime=09:00");

  const absentLogs = await db
    .collection("attendancelogs")
    .find({
      student_id: studentId,
      event_type: "entry",
      status: "absent",
      event_time: { $gte: tomorrow, $lt: tomorrowEnd },
    })
    .toArray();
  if (absentLogs.length !== 1) {
    fail("test-2b", `expected 1 absent log, got ${absentLogs.length}`);
    return;
  }
  created.logs.push(absentLogs[0]._id);
  const al = absentLogs[0];
  // markAbsencesForSchool escribe la hora local como UTC (setUTCHours sobre
  // un Date construido con toLocalDate, que tiene UTC Y/M/D = local Y/M/D).
  // El timestamp almacenado es 09:15 (interpretable como local 09:15).
  if (al.event_time.getUTCHours() !== 9 || al.event_time.getUTCMinutes() !== 15) {
    fail("test-2b", `expected absent log at 09:15 UTC (local cutoff), got ${al.event_time.toISOString()}`);
    return;
  }
  log("test-2b PASS: absent log event_time = 09:15 (special cutoff)");

  // ----------------------------------------------------------------------
  // TEST 3: day "normal" (sin entry en SchoolCalendar) usa shift.startTime.
  // ----------------------------------------------------------------------
  const dayAfter = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);
  const dayAfterEnd = new Date(dayAfter.getTime() + 24 * 60 * 60 * 1000);
  await db.collection("attendancelogs").deleteMany({
    student_id: studentId,
    event_time: { $gte: dayAfter, $lt: dayAfterEnd },
  });

  const r3 = await attendanceService.markAbsencesForSchool(schoolId, fakeSY, dayAfter);
  if (r3.shiftsProcessed[0].startTime !== "08:00") {
    fail("test-3", `expected normal startTime=08:00, got ${r3.shiftsProcessed[0].startTime}`);
    return;
  }
  log("test-3 PASS: day without special_schedule uses normal startTime=08:00");

  const al3 = await db
    .collection("attendancelogs")
    .findOne({
      student_id: studentId,
      event_type: "entry",
      status: "absent",
      event_time: { $gte: dayAfter, $lt: dayAfterEnd },
    });
  created.logs.push(al3._id);
  if (al3.event_time.getUTCHours() !== 8 || al3.event_time.getUTCMinutes() !== 15) {
    fail("test-3b", `expected 08:15 (08:00+15 local), got ${al3.event_time.toISOString()}`);
    return;
  }
  log("test-3b PASS: normal day absent log = 08:15 (local cutoff)");

  // ----------------------------------------------------------------------
  // TEST 4: runExitCheckForSchool marca exit_missing en alumno con entry sin exit.
  // ----------------------------------------------------------------------
  // Limpiar logs del día especial y crear solo un entry (sin exit).
  await db.collection("attendancelogs").deleteMany({
    student_id: studentId,
    event_time: { $gte: tomorrow, $lt: tomorrowEnd },
  });
  // Entry a 07:30 local = 13:30 UTC del día local "mañana".
  const fakeEntry = await db.collection("attendancelogs").insertOne({
    school: schoolId,
    student_id: studentId,
    event_type: "entry",
    event_time: new Date(tomorrow.getTime() + 13 * 3600 * 1000 + 30 * 60 * 1000),
    device: "smoke-test-device",
    verificationMode: "RFID",
    status: "on_time",
    exit_missing: false,
    notification_sent: false,
    createdAt: now,
    updatedAt: now,
  });
  created.logs.push(fakeEntry.insertedId);

  const exitResult = await attendanceService.runExitCheckForSchool(schoolId, fakeSY, tomorrow);
  if (exitResult.shiftsProcessed[0].endTime !== "12:30") {
    fail("test-4a", `expected effective endTime=12:30, got ${JSON.stringify(exitResult)}`);
    return;
  }
  if (exitResult.flagged !== 1) {
    fail("test-4a", `expected 1 flagged, got ${exitResult.flagged}`);
    return;
  }
  log("test-4a PASS: runExitCheckForSchool used special_exit_time=12:30 and flagged student");

  const flagged = await db.collection("attendancelogs").findOne({ _id: fakeEntry.insertedId });
  if (!flagged.exit_missing || !flagged.exit_missing_at) {
    fail("test-4b", `expected exit_missing=true on entry log, got ${JSON.stringify(flagged)}`);
    return;
  }
  log("test-4b PASS: entry log flagged with exit_missing=true and exit_missing_at");

  // ----------------------------------------------------------------------
  // TEST 5: alumno con absent log NO se marca (no estuvo en la escuela).
  // ----------------------------------------------------------------------
  await db.collection("attendancelogs").deleteMany({
    student_id: studentId,
    event_time: { $gte: dayAfter, $lt: dayAfterEnd },
  });
  await db.collection("attendancelogs").insertOne({
    school: schoolId,
    student_id: studentId,
    event_type: "entry",
    event_time: new Date(dayAfter.getTime() + 14 * 3600 * 1000 + 15 * 60 * 1000),
    device: "auto@system",
    verificationMode: "MANUAL",
    status: "absent",
    exit_missing: false,
    notification_sent: false,
    createdAt: now,
    updatedAt: now,
  });

  const r5 = await attendanceService.runExitCheckForSchool(schoolId, fakeSY, dayAfter);
  if (r5.flagged !== 0) {
    fail("test-5", `expected 0 flagged (absent), got ${r5.flagged}`);
    return;
  }
  log("test-5 PASS: absent student is NOT flagged for missing exit");

  // ----------------------------------------------------------------------
  // TEST 6: determineNextType cross-day → entry.
  // ----------------------------------------------------------------------
  // Limpiar logs del día normal para que solo quede el absent.
  const allDayAfterLogs = await db
    .collection("attendancelogs")
    .find({ student_id: studentId, event_time: { $gte: dayAfter, $lt: dayAfterEnd } })
    .toArray();
  for (const l of allDayAfterLogs) created.logs.push(l._id);

  // Asegurar que hay un log de AYER para el student.
  // yesterday local = tomorrow local - 24h.
  const yesterdayLocal = new Date(tomorrowLocal);
  yesterdayLocal.setUTCDate(yesterdayLocal.getUTCDate() - 1);
  const yesterday = new Date(yesterdayLocal.getTime() - utcOffsetMs + 13 * 3600 * 1000); // 13:00 UTC of yesterday = 07:00 local

  const yRes = await db.collection("attendancelogs").insertOne({
    school: schoolId,
    student_id: studentId,
    event_type: "entry",
    event_time: yesterday,
    device: "smoke-test",
    verificationMode: "RFID",
    createdAt: now,
    updatedAt: now,
  });
  created.logs.push(yRes.insertedId);

  // determineNextType se llama con eventTime de mañana local 02:00 (= UTC 08:00).
  const nextEvent = new Date(tomorrow.getTime() + 8 * 3600 * 1000);
  const next = await attendanceService.determineNextType(studentId, nextEvent);
  if (next !== "entry") {
    fail("test-6", `expected entry across day boundary, got ${next}`);
    return;
  }
  log("test-6 PASS: determineNextType returns 'entry' across day boundary");

  // ----------------------------------------------------------------------
  // TEST 7: clearing de exit_missing al crear exit log.
  // ----------------------------------------------------------------------
  // Borrar TODOS los logs del student para empezar limpio (test-6 dejó uno
  // de ayer que podría confundir determineNextType si entramos al exit tap
  // en otro día de Mexico).
  await db.collection("attendancelogs").deleteMany({ student_id: studentId });

  // Re-crear entry con exit_missing=true.
  const reEntry = await db.collection("attendancelogs").insertOne({
    school: schoolId,
    student_id: studentId,
    event_type: "entry",
    event_time: new Date(tomorrow.getTime() + 13 * 3600 * 1000 + 30 * 60 * 1000),
    device: "smoke-test-device",
    verificationMode: "RFID",
    status: "on_time",
    exit_missing: true,
    exit_missing_at: new Date(),
    notification_sent: false,
    createdAt: now,
    updatedAt: now,
  });
  created.logs.push(reEntry.insertedId);
  // Tambien el log que va a crear registerAttendanceEvent (exit).
  // Lo empujamos a created.logs después de crearlo.

  // Llamar registerAttendanceEvent con un exit tap. El eventTime debe ser
  // posterior al entry para que determineNextType lo catalogue como "exit".
  // Exit a las 18:00 local del día especial = tomorrow + 12h UTC (porque
  // tomorrow = tomorrowLocal + 6h, +12h = tomorrowLocal + 18h UTC = 12:00 local
  // — no, queremos 18:00 local = tomorrowLocal + 24h UTC, es decir tomorrow + 18h).
  // OJO: mañana local 18:00 = (tomorrowLocal + 24h) UTC. Y nuestro entry está
  // a mañana local 13:30 = (tomorrowLocal + 19.5h) UTC. La diferencia entre
  // entry y exit en Mexico: 4.5h.
  const exitTap = new Date(tomorrow.getTime() + 18 * 3600 * 1000); // Mexico 18:00
  log(`test-7: entry event_time=${new Date(tomorrow.getTime() + 13 * 3600 * 1000 + 30 * 60 * 1000).toISOString()}, exit tap=${exitTap.toISOString()}`);
  const Student = require(path.join(__dirname, "..", "models", "Student.model.js"));
  const studentObj = await Student.findById(studentId).lean();

  // Sanity: determineNextType con exit tap debería decir "exit" (last log es entry mismo día).
  const nextType = await attendanceService.determineNextType(studentId, exitTap);
  log(`test-7: determineNextType says "${nextType}" for exit tap`);

  const regResult = await attendanceService.registerAttendanceEvent({
    student: studentObj,
    eventTime: exitTap,
    device: "smoke-test-device",
    verificationMode: "RFID",
    snapshotUrl: null,
  });
  log(`test-7: registerAttendanceEvent result eventType=${regResult.eventType} duplicate=${regResult.duplicate}`);

  // Listar todos los logs de mañana para entender.
  const allDayLogs = await db.collection("attendancelogs")
    .find({ student_id: studentId, event_time: { $gte: tomorrow, $lt: tomorrowEnd } })
    .sort({ event_time: 1 })
    .toArray();
  log(`test-7: ${allDayLogs.length} logs after exit tap:`);
  for (const l of allDayLogs) {
    log(`  - id=${l._id} type=${l.event_type} time=${l.event_time.toISOString()} exit_missing=${l.exit_missing}`);
  }

  const cleared = await db.collection("attendancelogs").findOne({ _id: reEntry.insertedId });
  if (cleared.exit_missing) {
    fail("test-7", `expected exit_missing=false after exit log, got ${cleared.exit_missing}`);
    return;
  }
  log("test-7 PASS: exit log creation clears exit_missing on entry log");

  log("ALL PASS");
}

run()
  .then(async () => {
    await cleanup();
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[smoke] unexpected:", err);
    await cleanup();
    await mongoose.disconnect();
    process.exit(1);
  });
