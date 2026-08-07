// Modelo de Turno / Plantilla de Horario (SchoolShift)
// Define la "campana" de la escuela: a qué hora empieza y termina el turno y
// en qué módulos se parte la jornada, incluidos los recesos. Es la plantilla
// que después consume ClassSchedule para armar el horario de cada grupo.
//
// Ejemplo:
//   { name: "Turno Matutino", shift: "matutino",
//     startTime: "07:30", endTime: "14:30", moduleDurationMinutes: 50,
//     timeBlocks: [
//       { name: "Módulo 1", startTime: "07:30", endTime: "08:20", isBreak: false },
//       { name: "Módulo 2", startTime: "08:20", endTime: "09:10", isBreak: false },
//       { name: "Receso",   startTime: "09:10", endTime: "09:30", isBreak: true  },
//     ] }
//
// Los TimeBlocks son SUBDOCUMENTOS con `_id` propio: ClassSchedule guarda esos
// ObjectIds en `scheduleSlots.timeBlockRefs`. Ver la nota de integridad
// referencial al pie del archivo — es la parte delicada de este diseño.
const { Schema, model } = require("mongoose");

// "HH:mm" en formato 24 h. Se guarda como String y no como Date a propósito:
// un módulo es una hora de reloj recurrente, no un instante en el tiempo, y
// así se evita arrastrar zona horaria y horario de verano.
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TIME_MESSAGE = "Time must be in 24h HH:mm format (e.g. '07:30').";

// "07:30" → 450. Base común para comparar y ordenar bloques.
const toMinutes = (hhmm) => {
  if (typeof hhmm !== "string" || !TIME_PATTERN.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const timeBlockSchema = new Schema(
  {
    // "Módulo 1", "Receso", "Honores a la bandera"...
    name: {
      type: String,
      required: [true, "Time block name is required."],
      trim: true,
      maxlength: 60,
    },
    startTime: {
      type: String,
      required: [true, "Time block startTime is required."],
      trim: true,
      match: [TIME_PATTERN, TIME_MESSAGE],
    },
    endTime: {
      type: String,
      required: [true, "Time block endTime is required."],
      trim: true,
      match: [TIME_PATTERN, TIME_MESSAGE],
    },
    // Los recesos ocupan un hueco en la campana pero NO son asignables:
    // el controller de ClassSchedule debe rechazar un timeBlockRef con
    // isBreak: true.
    isBreak: {
      type: Boolean,
      default: false,
    },
    // Posición cronológica dentro del turno (0-based). Se recalcula sola en
    // el pre-validate; NO la asignes a mano. Es lo que permite detectar
    // módulos contiguos (dobles/triples) comparando `order` consecutivos.
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    // _id explícito: es la clave a la que apunta ClassSchedule.
    _id: true,
    timestamps: false,
    versionKey: false,
  }
);

const schoolShiftSchema = new Schema(
  {
    // Referencia a la escuela (tenant) — obligatoria para aislamiento multi-tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Ciclo escolar al que pertenece esta campana. Las escuelas reacomodan
    // horarios entre ciclos (cambia la duración del módulo, se mueve el
    // receso), y los horarios históricos deben seguir resolviendo sus
    // TimeBlocks contra la campana que estaba vigente cuando se armaron.
    // Para arrancar un ciclo nuevo, clonar el turno del anterior: se generan
    // `_id` de bloque nuevos y los ClassSchedule viejos quedan intactos.
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
      index: true,
    },
    // Nombre visible: "Turno Matutino", "Turno Vespertino", "Sabatino"...
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
      maxlength: 60,
    },
    // Enlaza la plantilla con `Group.shift`, que ya usa este mismo enum.
    // Es lo que permite resolver "el horario que le toca a 2°B" sin que el
    // grupo tenga que referenciar el turno explícitamente.
    shift: {
      type: String,
      required: [true, "Shift is required."],
      enum: {
        values: ["matutino", "vespertino"],
        message: "shift must be: matutino or vespertino.",
      },
      default: "matutino",
    },
    startTime: {
      type: String,
      required: [true, "startTime is required."],
      trim: true,
      match: [TIME_PATTERN, TIME_MESSAGE],
    },
    endTime: {
      type: String,
      required: [true, "endTime is required."],
      trim: true,
      match: [TIME_PATTERN, TIME_MESSAGE],
    },
    // Duración nominal de un módulo. Es el valor por defecto que usa el front
    // para autogenerar la campana; los bloques reales mandan sobre este número
    // (un receso dura 20 min aunque el módulo nominal sea de 50).
    moduleDurationMinutes: {
      type: Number,
      required: [true, "moduleDurationMinutes is required."],
      min: [5, "moduleDurationMinutes must be at least 5."],
      max: [240, "moduleDurationMinutes must be at most 240."],
      default: 50,
    },
    timeBlocks: {
      type: [timeBlockSchema],
      default: [],
    },
    // Soft delete: un turno con horarios históricos no se borra, se desactiva.
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

// Valida la campana completa: coherencia del turno, de cada bloque, y que los
// bloques no se encimen entre sí. Además reordena `timeBlocks` cronológicamente
// y recalcula `order`, que es de lo que depende la detección de contigüidad.
schoolShiftSchema.pre("validate", function (next) {
  const shiftStart = toMinutes(this.startTime);
  const shiftEnd = toMinutes(this.endTime);

  if (shiftStart !== null && shiftEnd !== null && shiftEnd <= shiftStart) {
    this.invalidate("endTime", "endTime must be later than startTime.");
    return next();
  }

  if (!Array.isArray(this.timeBlocks) || this.timeBlocks.length === 0) {
    return next();
  }

  // 1) Cada bloque debe ser coherente consigo mismo y caber en el turno.
  for (const block of this.timeBlocks) {
    const from = toMinutes(block.startTime);
    const to = toMinutes(block.endTime);
    if (from === null || to === null) return next(); // el `match` ya reportará

    if (to <= from) {
      this.invalidate(
        "timeBlocks",
        `Time block "${block.name}" ends at or before it starts (${block.startTime}–${block.endTime}).`
      );
      return next();
    }
    if (shiftStart !== null && shiftEnd !== null && (from < shiftStart || to > shiftEnd)) {
      this.invalidate(
        "timeBlocks",
        `Time block "${block.name}" (${block.startTime}–${block.endTime}) falls outside the shift window ${this.startTime}–${this.endTime}.`
      );
      return next();
    }
  }

  // 2) Orden cronológico + numeración. Se ordena SIEMPRE: el orden en que el
  //    cliente mandó el array es irrelevante, la campana la define el reloj.
  this.timeBlocks.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  this.timeBlocks.forEach((block, i) => {
    block.order = i;
  });

  // 3) Sin solapamientos. Ya ordenados, basta comparar con el anterior.
  for (let i = 1; i < this.timeBlocks.length; i += 1) {
    const prev = this.timeBlocks[i - 1];
    const curr = this.timeBlocks[i];
    if (toMinutes(curr.startTime) < toMinutes(prev.endTime)) {
      this.invalidate(
        "timeBlocks",
        `Time blocks "${prev.name}" (${prev.startTime}–${prev.endTime}) and "${curr.name}" (${curr.startTime}–${curr.endTime}) overlap.`
      );
      return next();
    }
  }

  return next();
});

// Un turno no puede repetir nombre dentro del MISMO ciclo de la escuela.
// Sí puede repetirse entre ciclos: "Turno Matutino" existe en 2025-2026 y en
// 2026-2027 como dos documentos independientes, que es justo lo que permite
// clonar la campana sin tocar los horarios del año anterior.
schoolShiftSchema.index(
  { school: 1, school_year_id: 1, name: 1 },
  { unique: true, name: "uniq_school_year_shift_name" }
);
// "¿Qué campana le toca al turno matutino de este ciclo?"
schoolShiftSchema.index({ school: 1, school_year_id: 1, shift: 1, isActive: 1 });

// Devuelve los subdocumentos de bloque correspondientes a una lista de ids,
// en orden cronológico. Es el "populate" manual que necesita ClassSchedule:
// Mongoose NO puede poblar subdocumentos de otra colección automáticamente.
schoolShiftSchema.methods.resolveBlocks = function (blockIds) {
  const wanted = new Set((blockIds || []).map(String));
  return this.timeBlocks
    .filter((b) => wanted.has(String(b._id)))
    .sort((a, b) => a.order - b.order);
};

// Verdadero si los bloques indicados son consecutivos en la campana
// (módulo doble/triple). Útil para validar en el controller que un "bloque
// de 100 min" no se armó con módulos sueltos de la mañana y de la tarde.
schoolShiftSchema.methods.areContiguous = function (blockIds) {
  const blocks = this.resolveBlocks(blockIds);
  if (blocks.length !== (blockIds || []).length) return false;
  for (let i = 1; i < blocks.length; i += 1) {
    if (blocks[i].order !== blocks[i - 1].order + 1) return false;
  }
  return true;
};

const SchoolShift = model("SchoolShift", schoolShiftSchema);

module.exports = SchoolShift;
module.exports.toMinutes = toMinutes;
module.exports.TIME_PATTERN = TIME_PATTERN;

// === NOTA DE INTEGRIDAD REFERENCIAL ====================================
// `ClassSchedule.scheduleSlots.timeBlockRefs` guarda los `_id` de estos
// subdocumentos. MongoDB no tiene claves foráneas, y aquí el "padre" vive en
// OTRA colección, así que nada impide borrar un bloque que ya está en uso y
// dejar referencias colgantes.
//
// Reglas que el controller de SchoolShift DEBE aplicar:
//   1. Al editar `timeBlocks`, NUNCA reconstruir el array desde cero (eso
//      regenera todos los `_id` e invalida todos los horarios). Modificar los
//      subdocumentos existentes por `_id` y sólo hacer push de los nuevos.
//   2. Antes de quitar un bloque, verificar que ningún ClassSchedule activo lo
//      referencie:
//        ClassSchedule.exists({ "scheduleSlots.timeBlockRefs": blockId })
//      Si existe, responder 409 en vez de borrar.
