// scripts/create-super-admin.js
// ---------------------------------------------------------------------
// Crea el primer super_admin del sistema. Corre UNA sola vez después del
// primer deploy en Render, contra la base de Mongo de producción.
//
// Por qué un script y no POST /auth/signup:
//   - El endpoint signup exige `school` para roles no super_admin, pero
//     `school: null` requiere que el role sea super_admin — y el flujo
//     de signup no expone "super_admin" en los enums de la UI ni en la
//     documentación. Un script CLI es el único camino soportado para
//     crear ese bootstrap.
//   - El pre-save hook del modelo User hashea el password si está
//     modificado; el script usa User.create() (no updateOne) para que
//     el hash pase por el hook. Si lo insertaras a mano en Atlas, el
//     password quedaría en texto plano y el login fallaría.
//
// Uso:
//   node scripts/create-super-admin.js \
//     --email admin@edukcontrol.mx \
//     --name "Aldo" \
//     --last_name "González" \
//     --phone "5512345678" \
//     --password "TuPassword123"
//
// Flags opcionales:
//   --dry-run         Lee BD, verifica que no exista, y no escribe nada.
//   --force           Omite la confirmación si el super_admin ya existe
//                     (no recomendado, útil solo para entornos dev).
//
// Conexión:
//   Usa MONGO_URI del .env. Si lo corres desde tu Mac contra la BD de
//   Atlas, exportá MONGO_URI antes:
//     $ export MONGO_URI="mongodb+srv://USER:PASS@cluster0.xxx.mongodb.net/eduk_control"
//     $ node scripts/create-super-admin.js --email ... --password ...

require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User.model");

// ── Parsing args ─────────────────────────────────────────────────────
const parseArgs = () => {
  const out = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i];
    const v = process.argv[i + 1];
    if (k && k.startsWith("--")) {
      out[k.slice(2)] = v;
      i++;
    }
  }
  return out;
};

// ── Validación mínima ───────────────────────────────────────────────
const validate = (args) => {
  const errors = [];
  const { email, name, last_name, phone, password } = args;
  if (!email) errors.push("--email requerido");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.push("--email con formato inválido");
  if (!name) errors.push("--name requerido");
  if (!last_name) errors.push("--last_name requerido");
  if (!phone) errors.push("--phone requerido");
  else if (!/^\d{10}$/.test(phone))
    errors.push("--phone debe ser 10 dígitos (formato MX)");
  if (!password) errors.push("--password requerido");
  else if (password.length < 8)
    errors.push("--password debe tener al menos 8 caracteres");
  return errors;
};

// ── Main ────────────────────────────────────────────────────────────
const main = async () => {
  const args = parseArgs();
  const errors = validate(args);
  if (errors.length) {
    console.error("\n[!] Argumentos inválidos:\n  - " + errors.join("\n  - "));
    console.error(
      "\nUso:\n" +
        "  node scripts/create-super-admin.js \\\n" +
        "    --email admin@edukcontrol.mx \\\n" +
        "    --name 'Aldo' --last_name 'González' \\\n" +
        "    --phone '5512345678' --password 'TuPassword123'\n"
    );
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error(
      "[!] MONGO_URI no está definido. Cargá .env o exportá la variable antes de correr el script."
    );
    process.exit(1);
  }

  const dryRun = args["dry-run"] === "true" || args["dry-run"] === "1";
  const force = args.force === "true" || args.force === "1";

  console.log(`[create-super-admin] dry-run=${dryRun} force=${force}`);
  console.log(`[create-super-admin] MONGO_URI host: ${safeMongoHost(process.env.MONGO_URI)}`);

  await mongoose.connect(process.env.MONGO_URI);

  try {
    // 1) ¿Ya existe un super_admin? Avisamos y abortamos (a menos que --force).
    const existing = await User.findOne({ role: "super_admin" });
    if (existing && !force) {
      console.error(
        `\n[!] Ya existe un super_admin:\n` +
          `    _id: ${existing._id}\n` +
          `    name: ${existing.name} ${existing.last_name || ""}\n` +
          `    email: ${existing.email || "(sin email)"}\n` +
          `    phoneNumber: ${existing.phoneNumber}\n` +
          `    isActive: ${existing.isActive}\n\n` +
          `Si querés resetear el password, usá:\n` +
          `  node scripts/reset-user-password.js ${existing.phoneNumber} 'NuevaPass'\n\n` +
          `Para forzar la creación (ignorar el existente), pasá --force.`
      );
      process.exit(1);
    }

    // 2) Verificamos que el phone/email no estén usados por otro User.
    const phoneClash = await User.findOne({ phoneNumber: args.phone });
    if (phoneClash) {
      console.error(
        `[!] phoneNumber ${args.phone} ya existe (role=${phoneClash.role}, email=${phoneClash.email || "—"})`
      );
      process.exit(1);
    }
    const emailClash = await User.findOne({ email: args.email.toLowerCase() });
    if (emailClash) {
      console.error(
        `[!] email ${args.email} ya existe (role=${emailClash.role}, phoneNumber=${emailClash.phoneNumber})`
      );
      process.exit(1);
    }

    // 3) Confirmación explícita en el modo real (no en dry-run).
    if (!dryRun) {
      console.log("\nResumen del super_admin a crear:");
      console.log("  email:       " + args.email);
      console.log("  name:        " + args.name);
      console.log("  last_name:   " + args.last_name);
      console.log("  phoneNumber: " + args.phone);
      console.log("  role:        super_admin");
      console.log("  isActive:    true");
      console.log("  school:      null  (cross-tenant)");
      console.log("\n¿Continuar? (escribí `yes` para confirmar)");
      process.stdin.setEncoding("utf8");
      const answer = await new Promise((resolve) => {
        process.stdin.once("data", (data) => resolve(String(data).trim()));
        process.stdin.once("error", () => resolve(""));
      });
      if (answer !== "yes") {
        console.log("[abort] cancelado por el usuario");
        process.exit(0);
      }
    }

    // 4) Creamos el User con User.create() para que dispare el pre-save
    //    hook (hashea el password con bcrypt cost 12).
    if (dryRun) {
      console.log(
        "[dry-run] OK: validación correcta. Re-ejecutá sin --dry-run para crear."
      );
      process.exit(0);
    }

    const created = await User.create({
      name: args.name,
      last_name: args.last_name,
      email: args.email.toLowerCase(),
      phoneNumber: args.phone,
      password: args.password,
      role: "super_admin",
      school: null, // cross-tenant
      isActive: true,
      sex: null,
    });

    console.log(
      `\n[ok] super_admin creado:\n` +
        `    _id: ${created._id}\n` +
        `    email: ${created.email}\n` +
        `    name: ${created.name} ${created.last_name}\n` +
        `    phoneNumber: ${created.phoneNumber}\n` +
        `    role: ${created.role}\n` +
        `    isActive: ${created.isActive}\n\n` +
        `Ya podés loguearte con POST /auth/login:\n` +
        `  { "phoneNumber": "${created.phoneNumber}", "password": "<la que pasaste>", "client": "web" }`
    );
  } catch (err) {
    console.error("[FAIL]", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

// Imprime solo el host del MONGO_URI para no leakear credenciales en logs.
const safeMongoHost = (uri) => {
  try {
    const u = new URL(uri);
    return `${u.protocol}//${u.username ? "***@" : ""}${u.hostname}${u.pathname}`;
  } catch {
    return "(uri no parseable)";
  }
};

main();
