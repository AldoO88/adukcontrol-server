// ShiftTemplate Model
// Plantilla de turno a nivel escuela (sin ciclo escolar).
// Permite definir los turnos de la escuela UNA vez y luego copiarlos
// al crear un ciclo escolar nuevo.
//
// El modelo SchoolShift sigue existiendo por ciclo — estos templates
// se clonan a SchoolShifts cuando se crea/clona un SchoolYear.
const { Schema, model } = require("mongoose");

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TIME_MESSAGE = "Time must be in 24h HH:mm format (e.g. '07:30').";

const toMinutes = (hhmm) => {
  if (typeof hhmm !== "string" || !TIME_PATTERN.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const timeBlockTemplateSchema = new Schema(
  {
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
    isBreak: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    _id: true,
    timestamps: false,
    versionKey: false,
  }
);

const shiftTemplateSchema = new Schema(
  {
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    name: {
      type: String,
      required: [true, "Name is required."],
      trim: true,
      maxlength: 60,
    },
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
    moduleDurationMinutes: {
      type: Number,
      required: [true, "moduleDurationMinutes is required."],
      min: [5, "moduleDurationMinutes must be at least 5."],
      max: [240, "moduleDurationMinutes must be at most 240."],
      default: 50,
    },
    timeBlocks: {
      type: [timeBlockTemplateSchema],
      default: [],
    },
    gracePeriodMinutes: {
      type: Number,
      default: 30,
      min: [0, "gracePeriodMinutes must be at least 0."],
      max: [120, "gracePeriodMinutes must be at most 120."],
    },
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

// Validación de coherencia del turno (misma lógica que SchoolShift)
shiftTemplateSchema.pre("validate", function (next) {
  const shiftStart = toMinutes(this.startTime);
  const shiftEnd = toMinutes(this.endTime);

  if (shiftStart !== null && shiftEnd !== null && shiftEnd <= shiftStart) {
    this.invalidate("endTime", "endTime must be later than startTime.");
    return next();
  }

  if (!Array.isArray(this.timeBlocks) || this.timeBlocks.length === 0) {
    return next();
  }

  for (const block of this.timeBlocks) {
    const from = toMinutes(block.startTime);
    const to = toMinutes(block.endTime);
    if (from === null || to === null) return next();

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

  this.timeBlocks.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  this.timeBlocks.forEach((block, i) => {
    block.order = i;
  });

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

// Nombre de plantilla único por escuela
shiftTemplateSchema.index(
  { school: 1, name: 1 },
  { unique: true, name: "uniq_school_shift_template_name" }
);

const ShiftTemplate = model("ShiftTemplate", shiftTemplateSchema);

module.exports = ShiftTemplate;
