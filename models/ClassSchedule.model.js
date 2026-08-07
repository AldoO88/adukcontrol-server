// Modelo de Horario de Clase (ClassSchedule)
// Es la tabla pivote del horario escolar: enlaza CICLO + GRUPO + MATERIA +
// MAESTRO y dice en qué días y en qué módulos de la campana se imparte.
//
// Un documento = una asignatura de un grupo con su maestro durante todo el
// ciclo. Todas sus sesiones semanales viven en `scheduleSlots`:
//
//   {
//     group_id: <2°B>, subject_id: <Matemáticas>, teacher_id: <Carlos>,
//     school_shift_id: <Turno Matutino>,
//     scheduleSlots: [
//       { dayOfWeek: 1, timeBlockRefs: [<Módulo 1>, <Módulo 2>] }, // doble el lunes
//       { dayOfWeek: 3, timeBlockRefs: [<Módulo 4>] },             // sencillo el miércoles
//     ]
//   }
//
// MÓDULOS DOBLES / TRIPLES: son simplemente varios `timeBlockRefs`
// consecutivos dentro del MISMO slot. No hay documentos duplicados ni un campo
// "duración": la contigüidad se valida con `SchoolShift#areContiguous`.
//
// RELACIÓN CON TeacherSubject: aquel modelo responde "¿quién PUEDE calificar
// qué?" (matriz de permisos); éste responde "¿cuándo se imparte?". Se dejan
// separados a propósito — una asignación puede existir sin horario cargado.
const { Schema, model } = require("mongoose");

// Convención de JavaScript (`Date.prototype.getDay()`): 0 = domingo … 6 = sábado.
// Se usa la misma numeración para poder hacer `new Date().getDay()` y filtrar
// directo, sin tablas de conversión.
const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6];

const scheduleSlotSchema = new Schema(
  {
    dayOfWeek: {
      type: Number,
      required: [true, "dayOfWeek is required."],
      enum: {
        values: DAYS_OF_WEEK,
        message: "dayOfWeek must be 0 (Sunday) through 6 (Saturday).",
      },
    },
    // Módulos de la campana que ocupa esta sesión, dentro del SchoolShift
    // referenciado por `school_shift_id`. Varios ids = módulo doble o triple.
    // Deben ser contiguos y no ser recesos: lo valida el controller con los
    // helpers de SchoolShift (el schema no puede, vive en otra colección).
    timeBlockRefs: {
      type: [Schema.Types.ObjectId],
      required: [true, "timeBlockRefs is required."],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "A schedule slot must reference at least one time block.",
      },
    },
    // Aula opcional. Se guarda por slot y no por documento porque una misma
    // materia puede darse en salón normal y en laboratorio según el día.
    classroom: {
      type: String,
      default: null,
      trim: true,
      maxlength: 40,
    },
  },
  {
    _id: false,
    versionKey: false,
  }
);

const classScheduleSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — obligatoria para aislamiento multi-tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Ciclo escolar: el horario se rehace cada año.
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
      index: true,
    },
    group_id: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: [true, "Group reference is required."],
      index: true,
    },
    subject_id: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: [true, "Subject reference is required."],
      index: true,
    },
    teacher_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Teacher reference is required."],
      index: true,
    },
    // Turno cuya campana define los `timeBlockRefs` de abajo.
    // IMPRESCINDIBLE: los TimeBlocks son subdocumentos de SchoolShift, así que
    // sin saber a qué turno pertenecen, sus ObjectIds no se pueden resolver.
    // Mongoose no sabe poblar un subdocumento de otra colección por sí solo.
    school_shift_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolShift",
      required: [true, "School shift reference is required."],
      index: true,
    },
    scheduleSlots: {
      type: [scheduleSlotSchema],
      default: [],
    },
    // Soft delete: al reacomodar el horario a media generación conviene
    // desactivar en vez de borrar, para no perder el histórico.
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Un mismo día no puede aparecer dos veces en el mismo documento (las sesiones
// de un día se acumulan en un solo slot), y un módulo no puede repetirse
// dentro del documento.
classScheduleSchema.pre("validate", function (next) {
  if (!Array.isArray(this.scheduleSlots) || this.scheduleSlots.length === 0) {
    return next();
  }

  const seenDays = new Set();
  const seenBlocks = new Set();

  for (const slot of this.scheduleSlots) {
    if (seenDays.has(slot.dayOfWeek)) {
      this.invalidate(
        "scheduleSlots",
        `dayOfWeek ${slot.dayOfWeek} appears more than once — merge its time blocks into a single slot.`
      );
      return next();
    }
    seenDays.add(slot.dayOfWeek);

    for (const ref of slot.timeBlockRefs) {
      const key = `${slot.dayOfWeek}:${String(ref)}`;
      if (seenBlocks.has(key)) {
        this.invalidate(
          "scheduleSlots",
          `Time block ${String(ref)} is referenced twice on day ${slot.dayOfWeek}.`
        );
        return next();
      }
      seenBlocks.add(key);
    }
  }

  return next();
});

// === Índices ============================================================
// "Horario del grupo" — también es el horario del ALUMNO, que se obtiene
// resolviendo su `current_group_id`. Es la consulta más frecuente.
classScheduleSchema.index(
  { school: 1, school_year_id: 1, group_id: 1 },
  { name: "idx_schedule_by_group" }
);
// "Horario del maestro" — su carga semanal completa, cruzando todos los grupos.
classScheduleSchema.index(
  { school: 1, school_year_id: 1, teacher_id: 1 },
  { name: "idx_schedule_by_teacher" }
);
// "¿Qué clases hay hoy?" — tableros del día y pase de lista.
// Índice multikey sobre el subdocumento.
classScheduleSchema.index(
  { school: 1, school_year_id: 1, "scheduleSlots.dayOfWeek": 1 },
  { name: "idx_schedule_by_day" }
);
// Integridad referencial inversa: antes de borrar un TimeBlock hay que poder
// preguntar rápido si alguien lo usa.
classScheduleSchema.index(
  { "scheduleSlots.timeBlockRefs": 1 },
  { name: "idx_schedule_by_time_block" }
);
// Una materia se carga UNA sola vez por (ciclo, grupo, maestro). Si dos
// maestros comparten la materia en el mismo grupo (co-docencia), son dos
// documentos distintos y el índice lo permite.
classScheduleSchema.index(
  { school_year_id: 1, group_id: 1, subject_id: 1, teacher_id: 1 },
  { unique: true, name: "uniq_year_group_subject_teacher" }
);

// NOTA: la detección de EMPALMES (dos materias del mismo grupo en el mismo
// módulo, o un maestro en dos grupos a la vez) NO se puede hacer con un índice
// único: vive en `scheduleSlots[]` y cruza documentos. Va en el controller,
// con una consulta previa al guardado:
//
//   ClassSchedule.findOne({
//     school, school_year_id, isActive: true,
//     _id: { $ne: currentId },
//     $or: [{ group_id }, { teacher_id }],
//     scheduleSlots: {
//       $elemMatch: { dayOfWeek, timeBlockRefs: { $in: incomingBlockIds } },
//     },
//   })

const ClassSchedule = model("ClassSchedule", classScheduleSchema);

module.exports = ClassSchedule;
module.exports.DAYS_OF_WEEK = DAYS_OF_WEEK;
