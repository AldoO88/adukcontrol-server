// scripts/smoke-guardian-reuse.js
// E2E mínimo para el endpoint nuevo y la regla de reuso sin pisar.
// Crea: school A + admin A + school B + admin B + schoolYear + group.
// Crea alumno 1 con tutor (vía POST /api/guardians).
// Crea alumno 2 con POST /api/guardians/:id/students (el nuevo endpoint).
// Crea alumno 3 vía import Excel con teléfono sin nombre del tutor existente.
// Verifica: 3 alumnos en Guardian.students, 1 solo User tutor, nombre intacto,
// 1 warning en import.

require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");

const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);

const School = require("../models/School.model");
const SchoolYear = require("../models/SchoolYear.model");
const Group = require("../models/Group.model");
const User = require("../models/User.model");
const Guardian = require("../models/Guardian.model");
const Student = require("../models/Student.model");
const Enrollment = require("../models/Enrollment.model");

const API = "http://localhost:5051";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("MONGO conectado:", process.env.MONGO_URI);

  // Limpiamos colecciones del smoke
  await Promise.all([
    School.deleteMany({}),
    SchoolYear.deleteMany({}),
    Group.deleteMany({}),
    User.deleteMany({}),
    Guardian.deleteMany({}),
    Student.deleteMany({}),
    Enrollment.deleteMany({}),
  ]);
  console.log("colecciones limpiadas");

  // ---- School A
  const schoolA = await School.create({
    name: "Escuela Smoke A",
    cct: "13DST0001A",
    isActive: true,
  });
  const schoolB = await School.create({
    name: "Escuela Smoke B",
    cct: "13DST0002A",
    isActive: true,
  });

  // ---- Admin users
  const adminA = await User.create({
    name: "Admin",
    last_name: "A",
    email: "admin.a@smoke.test",
    password: "Admin123!",
    role: "admin",
    school: schoolA._id,
    phoneNumber: "5500000001",
    isActive: true,
  });
  const adminB = await User.create({
    name: "Admin",
    last_name: "B",
    email: "admin.b@smoke.test",
    password: "Admin123!",
    role: "admin",
    school: schoolB._id,
    phoneNumber: "5500000002",
    isActive: true,
  });

  // ---- SchoolYear + Group (en A)
  const yearA = await SchoolYear.create({
    school: schoolA._id,
    name: "2026-2027",
    startDate: new Date("2026-08-15"),
    endDate: new Date("2027-07-15"),
    isActive: true,
  });
  await SchoolYear.create({
    school: schoolB._id,
    name: "2026-2027",
    startDate: new Date("2026-08-15"),
    endDate: new Date("2027-07-15"),
    isActive: true,
  });
  const groupA = await Group.create({
    school: schoolA._id,
    school_year_id: yearA._id,
    grade: 1,
    section: "A",
    type: "regular",
    shift: "matutino",
  });

  // ---- Login adminA y adminB
  const loginA = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.a@smoke.test", phoneNumber: "5500000001", password: "Admin123!" }),
  });
  const jsonA = await loginA.json();
  if (!jsonA.authToken) throw new Error("login admin A falló: " + JSON.stringify(jsonA));
  const tokenA = jsonA.authToken;
  console.log("login adminA OK");

  const loginB = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin.b@smoke.test", phoneNumber: "5500000002", password: "Admin123!" }),
  });
  const jsonB = await loginB.json();
  if (!jsonB.authToken) throw new Error("login admin B falló: " + JSON.stringify(jsonB));
  const tokenB = jsonB.authToken;

  // ---- Alumno 1: crea student + guardian (POST /api/guardians)
  const s1 = await fetch(`${API}/api/students/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      curp: "AAAA000000HDFAAA01",
      first_name: "Hijo1",
      last_name: "Pérez",
      school: schoolA._id.toString(),
      current_group_id: groupA._id.toString(),
    }),
  });
  const student1 = await s1.json();
  if (!student1._id) throw new Error("alumno 1 no creado: " + JSON.stringify(student1));
  console.log("alumno1 OK", student1._id);

  const g1 = await fetch(`${API}/api/guardians`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      name: "Juan",
      lastname: "Pérez Original",
      phone: "5511111111",
      relationship: "padre",
      school: schoolA._id.toString(),
      students: [student1._id.toString()],
    }),
  });
  const guardian1 = await g1.json();
  if (!guardian1._id) throw new Error("guardian1 no creado: " + JSON.stringify(guardian1));
  if (guardian1.status === 200) throw new Error("primer guardian debería ser 201");
  console.log("guardian1 OK (status: nuevo)", guardian1._id);

  // ---- Alumno 2: crea student + vincula por ID (nuevo endpoint)
  const s2 = await fetch(`${API}/api/students/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      curp: "AAAA000000HDFAAA02",
      first_name: "Hijo2",
      last_name: "Pérez",
      school: schoolA._id.toString(),
      current_group_id: groupA._id.toString(),
    }),
  });
  const student2 = await s2.json();
  if (!student2._id) throw new Error("alumno 2 no creado: " + JSON.stringify(student2));
  console.log("alumno2 OK", student2._id);

  const assign = await fetch(`${API}/api/guardians/${guardian1._id}/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ student_ids: [student2._id.toString()] }),
  });
  const assigned = await assign.json();
  if (!assign.ok) throw new Error("assign falló: " + assign.status + " " + JSON.stringify(assigned));
  if (!Array.isArray(assigned.students) || assigned.students.length !== 2) {
    throw new Error("guardian.students debería tener 2 alumnos, tiene " + (assigned.students?.length));
  }
  if (assigned.lastname !== "Pérez Original") {
    throw new Error("lastname del guardian fue PERSISTIDO, debería seguir 'Pérez Original'. Actual: " + assigned.lastname);
  }
  console.log("assignStudentsToGuardian OK — guardian.students = 2, lastname intacto");

  // Verificar espejo: el alumno2 debe tener al guardian1 en guardians
  const s2fresh = await Student.findById(student2._id);
  if (!s2fresh.guardians.map(String).includes(guardian1._id.toString())) {
    throw new Error("espejo roto: alumno2 no tiene al guardian en .guardians");
  }
  console.log("espejo Student.guardians OK");

  // Verificar 1 solo User tutor (no se duplicó)
  const tutorUsers = await User.find({ school: schoolA._id, role: "tutor", phoneNumber: "5511111111" });
  if (tutorUsers.length !== 1) {
    throw new Error("debería haber exactamente 1 User tutor con ese phone, hay " + tutorUsers.length);
  }
  console.log("User tutor único (1) OK");

  // ---- Test regla de no-pisar: reusar por teléfono con nombre DISTINTO
  const g1Override = await fetch(`${API}/api/guardians`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({
      name: "TYPO_CORRUPTO",  // nombre distinto al original
      lastname: "TYPO",
      phone: "5511111111",      // mismo teléfono
      relationship: "abuelo",   // parentesco distinto
      school: schoolA._id.toString(),
    }),
  });
  const g1After = await g1Override.json();
  if (g1After.name !== "Juan") {
    throw new Error("NO debe pisar nombre. Actual: " + g1After.name);
  }
  if (g1After.lastname !== "Pérez Original") {
    throw new Error("NO debe pisar lastname. Actual: " + g1After.lastname);
  }
  if (g1After.relationship !== "padre") {
    throw new Error("NO debe pisar relationship. Actual: " + g1After.relationship);
  }
  console.log("reuso no pisa datos OK (name/lastname/relationship intactos)");

  // ---- Cross-tenant: adminB intenta asignar alumno de A
  const cross = await fetch(`${API}/api/guardians/${guardian1._id}/students`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ student_ids: [student1._id.toString()] }),
  });
  if (cross.status !== 404) {
    throw new Error("cross-tenant debería ser 404, fue " + cross.status);
  }
  console.log("cross-tenant 404 OK");

  // ---- Lookup ?phone exacto
  const lookup = await fetch(`${API}/api/guardians?phone=5511111111`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const lookupJson = await lookup.json();
  if (!lookupJson.items || lookupJson.items.length !== 1) {
    throw new Error("lookup ?phone debería devolver 1, devolvió " + lookupJson.items?.length);
  }
  if (lookupJson.items[0]._id !== guardian1._id) {
    throw new Error("lookup ?phone devolvió el guardian equivocado");
  }
  console.log("GET ?phone exacto OK");

  // ---- Import Excel: alumno 3 con teléfono del tutor existente pero SIN nombre
  // Generamos el Excel en memoria
  const XLSX = require("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([
    ["CURP", "nombre", "apellido", "grupo", "tutor_telefono", "tutor_nombre", "tutor_apellido", "tutor_parentesco"],
    ["AAAA000000HDFAAA03", "Hijo3", "Pérez", "1A", "5511111111", "", "", ""],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Alumnos");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const formData = new FormData();
  formData.append("file", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "smoke.xlsx");
  formData.append("school_year_id", yearA._id.toString());
  formData.append("school", schoolA._id.toString());

  const imp = await fetch(`${API}/api/students/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenA}` },
    body: formData,
  });
  const impJson = await imp.json();
  if (!imp.ok) throw new Error("import falló: " + JSON.stringify(impJson));
  if (impJson.succeeded !== 1 || impJson.failed !== 0) {
    throw new Error("import debería tener 1 ok, fue " + JSON.stringify(impJson));
  }
  if (!impJson.results[0].guardian_reused) {
    throw new Error("import debería marcar guardian_reused=true en la fila");
  }
  if (impJson.results[0].guardian !== "Juan Pérez Original") {
    throw new Error("import debería traer nombre del guardian reusado: " + impJson.results[0].guardian);
  }
  console.log("import con reuso OK — guardian_reused:", impJson.results[0].guardian);

  // El guardian ahora debe tener 3 alumnos
  const gFinal = await Guardian.findById(guardian1._id).populate("students", "controlNumber first_name last_name");
  if (gFinal.students.length !== 3) {
    throw new Error("guardian debería tener 3 alumnos, tiene " + gFinal.students.length);
  }
  if (gFinal.lastname !== "Pérez Original") {
    throw new Error("lastname debería seguir 'Pérez Original' tras el import");
  }
  console.log("guardian final: 3 alumnos, lastname intacto OK");

  // ---- Import con teléfono sin nombre Y tutor NO existente → warning
  const ws2 = XLSX.utils.aoa_to_sheet([
    ["CURP", "nombre", "apellido", "grupo", "tutor_telefono", "tutor_nombre", "tutor_apellido"],
    ["AAAA000000HDFAAA04", "Hijo4", "García", "1A", "5588888888", "", ""],
  ]);
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, ws2, "Alumnos");
  const buf2 = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });
  const fd2 = new FormData();
  fd2.append("file", new Blob([buf2], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "smoke2.xlsx");
  fd2.append("school_year_id", yearA._id.toString());
  fd2.append("school", schoolA._id.toString());
  const imp2 = await fetch(`${API}/api/students/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenA}` },
    body: fd2,
  });
  const imp2Json = await imp2.json();
  if (!imp2.ok) throw new Error("import2 falló");
  if (imp2Json.succeeded !== 1) throw new Error("alumno4 debería crearse OK con warning");
  if (imp2Json.warnings < 1) throw new Error("debería haber 1 warning por teléfono sin nombre");
  console.log("import con tel sin nombre → warning OK:", imp2Json.warnings);

  console.log("\n✔ TODOS LOS SMOKE TESTS PASARON");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("✘ ERROR:", e.message);
  if (e.stack) console.error(e.stack);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
