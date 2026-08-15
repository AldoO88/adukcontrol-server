// Modelo de Estudiante
// Representa a un alumno inscrito en la escuela. Almacena datos personales,
// la tarjeta RFID, y la referencia a sus tutores/guardianes (modelo propio,
// ver Guardian.model.js). Cada estudiante pertenece a UNA escuela (tenant).
//
// El `controlNumber` se autogenera en el pre-save a partir de:
//   - YY  (2): año de inicio del ciclo escolar (SchoolYear.startDate).
//   - SHIFT (1): 1 = Matutino, 2 = Vespertino (derivado de Group.shift).
//   - CCT4 (4): bloque numérico de 4 dígitos de School.cct (formato "13DST0049E" → "0049").
//   - CONSEC (3): correlativo por (escuela, año, turno), con padStart(3, "0").
//
// Ejemplo: alumno inscrito en 2026, matutino, escuela 13DST0049E, primer
// correlativo → "2610049001". El número es estable durante los 3 años del
// ciclo (solo se asigna en `isNew`).
const { Schema, model } = require("mongoose");
const Group = require("./Group.model");
const School = require("./School.model");
const SchoolYear = require("./SchoolYear.model");

const studentSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — obligatoria para aislamiento multi-tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // CURP del estudiante (Clave Única de Registro de Población, 18 chars).
    // Se almacena en MAYÚSCULAS. Queda como dato personal del alumno
    // (validación contra RENAPO, reportes oficiales, etc.). El
    // controlNumber NO usa el CURP.
    curp: {
      type: String,
      required: [true, "CURP is required."],
      trim: true,
      uppercase: true,
      match: [
        /^[A-Z0-9]{18}$/,
        "CURP must be 18 uppercase alphanumeric characters.",
      ],
    },
    // Número de control autogenerado, 10 caracteres:
    //   YY(2) + SHIFT(1) + CCT4(4) + CONSEC(3)
    // Ejemplo: "2610049001" → ciclo 26, matutino, CCT 0049, correlativo 001.
    // Único DENTRO de la escuela (el CCT ya identifica a la escuela, pero
    // mantenemos el filtro por school en el pre-save como cinturón de
    // seguridad anti cross-tenant).
    // Se asigna una sola vez en el pre-save y NO se regenera en updates.
    controlNumber: {
      type: String,
      default: null,
      trim: true,
      match: [
        /^\d{2}[12]\d{4}\d{3}$/,
        'controlNumber must be 10 digits: YY(2) + SHIFT(1: "1"=Matutino, "2"=Vespertino) + CCT(4) + CONSEC(3).',
      ],
    },
    first_name: {
      type: String,
      required: [true, "First name is required."],
      trim: true,
    },
    last_name: {
      type: String,
      required: [true, "Last name is required."],
      trim: true,
    },
    // UID de la tarjeta RFID; único DENTRO de la escuela (opcional)
    rfid_card: {
      type: String,
      trim: true,
      uppercase: true,
    },
    // === Autenticación híbrida (RFID + reconocimiento facial) ============
    // User ID / PIN con el que el alumno está dado de alta en la terminal
    // facial ZKTeco. Es el valor que el dispositivo manda en el campo `PIN`
    // de cada registro ADMS (ver controllers/adms.controller.js).
    // Se guarda como String (no Number) porque el firmware lo trata como
    // cadena y admite ceros a la izquierda ("0042" ≠ "42").
    // Único DENTRO de la escuela — ver índice compuesto más abajo.
    biometricId: {
      type: String,
      default: null,
      trim: true,
    },
    // true cuando el alumno ya tiene su rostro registrado en la terminal.
    // Sirve para que el front distinguía "tiene biometricId asignado" de
    // "el enrolamiento en el dispositivo ya se completó".
    isFaceEnrolled: {
      type: Boolean,
      default: false,
    },
    // URL pública de la foto del estudiante (almacenada en Cloudinary).
    // Se actualiza vía POST /api/students/:studentId/photo.
    // Es también la foto de referencia que se carga en la terminal facial.
    photoUrl: {
      type: String,
      default: null,
      trim: true,
    },
    // Referencias a los tutores/guardianes (ver Guardian.model.js).
    // Reemplaza al subdoc embebido que existía antes.
    guardians: {
      type: [Schema.Types.ObjectId],
      ref: "Guardian",
      default: [],
    },
    // Grupo actual del estudiante. Es la Single Source of Truth para
    // `shift` y `school_year_id`; el pre-save hook los consulta para
    // componer el controlNumber. Si es null al crear, el controlNumber
    // queda null (el caller debe asignar un grupo antes/después).
    current_group_id: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      default: null,
    },
    // Taller (grupo de Tecnología) al que pertenece el alumno. Se elige UNA
    // sola vez al ingresar a primer grado (puede cambiar si se reasigna).
    // Es un grupo `type: "taller"` que mezcla alumnos de varios grupos de
    // origen del mismo grado. Al promover, el controller re-apunta este campo
    // al grupo taller del MISMO taller en el nuevo grado/ciclo.
    workshop_group_id: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: ["active", "withdrawn_temp", "withdrawn_permanent"],
        message:
          "Status must be one of: active, withdrawn_temp, withdrawn_permanent.",
      },
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// === Pre-save: autogenera controlNumber (solo en creación) ============
// Formato: YY(2) + SHIFT(1) + CCT4(4) + CONSEC(3) = 10 chars
// YY: año de inicio del ciclo escolar (SchoolYear.startDate), fallback a
//     año calendario si no hay school_year_id.
// SHIFT: derivado de Group.shift ("matutino"→"1", "vespertino"→"2").
// CCT4: bloque numérico de 4 dígitos extraído de School.cct (regex sobre
//       el formato estándar SEP "XXDDDNNNNX", p.ej. "13DST0049E" → "0049").
// CONSEC: correlativo por (escuela, año, turno), autoincremental.
//
// NOTA sobre concurrencia: este hook usa el patrón "find max + 1", que
// tiene una condición de carrera teórica: dos `save()` simultáneos con
// el mismo prefijo leerán el mismo máximo e intentarán insertar el
// mismo controlNumber. El índice único `{ school, controlNumber }` deja
// que MongoDB rechace el segundo con un E11000; el controller puede
// capturarlo y reintentar. En escenarios de inscripción manual la
// colisión es prácticamente inexistente; si la inscripción se vuelve
// masiva, migrar a una colección `Counter` con `findOneAndUpdate + $inc`
// atómico.
studentSchema.pre("save", async function (next) {
  // Solo en creación; los updates NO regeneran el número.
  if (!this.isNew) return next();
  // Si ya viene seteado (e.g. seed/migración), respetarlo.
  if (this.controlNumber) return next();

  // Si falta algún insumo crítico, dejamos que los validators devuelvan
  // un 400 claro en vez de inventar un número.
  if (!this.school || !this.current_group_id) return next();

  try {
    // 1) Resolver Group + School + SchoolYear en paralelo.
    //    Todos filtran por la escuela del documento (anti cross-tenant leak).
    const [group, schoolDoc, schoolYearDoc] = await Promise.all([
      Group.findOne({
        _id: this.current_group_id,
        school: this.school,
      })
        .select("shift school_year_id school")
        .lean(),
      School.findOne({ _id: this.school }).select("cct").lean(),
      // SchoolYear se filtra por el school_year_id del Group, que se
      // carga arriba. Si el Group lo trae, lo encontramos; si no, fallback
      // al año calendario más abajo.
      Group.findOne({ _id: this.current_group_id, school: this.school })
        .select("school_year_id")
        .lean()
        .then((g) =>
          g && g.school_year_id
            ? SchoolYear.findOne({ _id: g.school_year_id })
                .select("startDate")
                .lean()
            : null
        ),
    ]);

    if (!group) {
      return next(
        new Error(
          "current_group_id does not exist or belongs to a different school."
        )
      );
    }
    if (!schoolDoc || !schoolDoc.cct) {
      return next(
        new Error("School CCT is missing — cannot generate controlNumber.")
      );
    }

    // 2) Extraer el bloque de 4 dígitos numéricos del CCT.
    //    Formato SEP: "XX" (estado) + "DDD" (tipo, letras) + "NNNN" (número) + "X" (turno).
    //    Ej: "13DST0049E" → capturamos "0049".
    const cctMatch = schoolDoc.cct.match(/^[A-Z0-9]{2}[A-Z]{3}(\d{4})/);
    if (!cctMatch) {
      return next(
        new Error(
          `Could not extract 4-digit CCT number from "${schoolDoc.cct}". Expected format like "13DST0049E".`
        )
      );
    }
    const cct4 = cctMatch[1];

    // 3) Mapear shift: "matutino" → "1", "vespertino" → "2".
    let shiftDigit;
    if (group.shift === "matutino") shiftDigit = "1";
    else if (group.shift === "vespertino") shiftDigit = "2";
    else {
      return next(
        new Error(
          `Unsupported shift value "${group.shift}" — must be "matutino" or "vespertino".`
        )
      );
    }

    // 4) Año de inscripción: año de inicio del SchoolYear si está
    //    disponible; si no, año calendario (defensivo).
    let yy;
    if (schoolYearDoc && schoolYearDoc.startDate) {
      yy = String(new Date(schoolYearDoc.startDate).getFullYear()).slice(-2);
    }
    if (!yy) {
      yy = String(new Date().getFullYear()).slice(-2);
    }

    // 5) Componer el prefijo (7 chars) y armar el controlNumber (10 chars).
    const prefix = `${yy}${shiftDigit}${cct4}`;
    const PREFIX_LEN = prefix.length; // 7
    const TOTAL_LEN = 10;

    // 6) Encontrar el mayor controlNumber de esta escuela con este prefijo.
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const last = await this.constructor
      .findOne({
        school: this.school,
        controlNumber: {
          $type: "string",
          $regex: `^${escapedPrefix}`,
        },
      })
      .sort({ controlNumber: -1 })
      .select({ controlNumber: 1 })
      .lean();

    let nextConsec = 1;
    if (last && last.controlNumber) {
      const tail = last.controlNumber.slice(PREFIX_LEN, TOTAL_LEN);
      const parsed = parseInt(tail, 10);
      if (!Number.isNaN(parsed)) {
        nextConsec = parsed + 1;
      }
    }

    this.controlNumber = `${prefix}${String(nextConsec).padStart(3, "0")}`;
    next();
  } catch (err) {
    next(err);
  }
});

// Índices únicos por escuela (reemplazan los uniques globales previos)
// controlNumber único DENTRO de la escuela. Sparse para tolerar los
// documentos preexistentes (creados antes de este cambio) cuyo
// controlNumber aún es null.
studentSchema.index(
  { school: 1, controlNumber: 1 },
  {
    unique: true,
    name: "uniq_school_control_number",
    partialFilterExpression: { controlNumber: { $type: "string" } },
  }
);
studentSchema.index(
  { school: 1, rfid_card: 1 },
  {
    unique: true,
    name: "uniq_school_rfid_card",
    partialFilterExpression: { rfid_card: { $type: "string" } },
  }
);
// biometricId (User ID de la terminal ZKTeco) único DENTRO de la escuela.
// Se usa el mismo patrón compuesto + partial que rfid_card / controlNumber
// en lugar de un `unique: true, sparse: true` global: dos escuelas distintas
// tienen terminales distintas y ambas empiezan a numerar en 1, así que un
// unique global haría imposible dar de alta al alumno #1 de la segunda
// escuela. La desambiguación cross-tenant en el push ADMS se resuelve en
// controllers/adms.controller.js (ver nota sobre matches ambiguos).
studentSchema.index(
  { school: 1, biometricId: 1 },
  {
    unique: true,
    name: "uniq_school_biometric_id",
    partialFilterExpression: { biometricId: { $type: "string" } },
  }
);

studentSchema.index({ current_group_id: 1 });
studentSchema.index({ workshop_group_id: 1 });
studentSchema.index({ last_name: 1, first_name: 1 });
studentSchema.index({ guardians: 1 });
// Nota: el índice de fcm_token ahora vive en Guardian.model.js sobre guardian.fcm_token

const Student = model("Student", studentSchema);

module.exports = Student;
