// Subject Model
// Catalog of subjects offered by a school. This is the SINGLE source of truth
// for subject names: `Grade.subject_id`, `TeacherSubject.subject_id`, and
// `ClassSchedule.subject_id` all reference here.
//
// Previously subjects were stored as free strings in Grade.subject and
// TeacherSubject.subject, which allowed "Matemáticas", "matematicas" and
// "Mate" to coexist as different subjects and broke grade averages by subject.
// Migrated with scripts/migrate-subjects-to-refs.js.
const { Schema, model } = require("mongoose");

const subjectSchema = new Schema(
  {
    // Tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Educational level of the subject.
    // "BASIC" = Basic Education (NEM: Secondary)
    // "UPPER_SECONDARY" = Upper Secondary Education (MCCEMS: High School)
    // "HIGHER" = Higher Education (University)
    educationalLevel: {
      type: String,
      enum: {
        values: ["BASIC", "UPPER_SECONDARY", "HIGHER"],
        message: "educationalLevel must be BASIC, UPPER_SECONDARY, or HIGHER.",
      },
      required: [true, "Educational level is required."],
      default: "BASIC",
    },
    // Short code for the subject (e.g., "MAT-101", "ESP-101")
    code: {
      type: String,
      required: [true, "Subject code is required."],
      trim: true,
      uppercase: true,
      maxlength: 20,
    },
    // Full name (e.g., "Mathematics I", "Spanish")
    name: {
      type: String,
      required: [true, "Subject name is required."],
      trim: true,
      maxlength: 100,
    },
    // Macro category of the subject.
    // For NEM (Basic): "Formative Field" (e.g., "Linguistic", "Scientific")
    // For MCCEMS (Upper Secondary): "Sociocognitive Resource" (e.g., "Logic-mathematical")
    macroCategory: {
      type: String,
      default: null,
      trim: true,
      maxlength: 120,
    },
    // Classification type of the subject.
    // "DISCIPLINE" = Traditional academic subject
    // "WORKSHOP" = Practical workshop
    // "UAC" = Curricular Learning Unit (Upper Secondary)
    // "KNOWLEDGE_AREA" = Knowledge area (University)
    // "PROFESSIONAL_COMPONENT" = Professional component (Technical High School)
    classificationType: {
      type: String,
      enum: {
        values: ["DISCIPLINE", "WORKSHOP", "UAC", "KNOWLEDGE_AREA", "PROFESSIONAL_COMPONENT"],
        message: "classificationType must be DISCIPLINE, WORKSHOP, UAC, KNOWLEDGE_AREA, or PROFESSIONAL_COMPONENT.",
      },
      default: "DISCIPLINE",
    },
    // Subject credits (useful for Upper Secondary and Higher Education)
    credits: {
      type: Number,
      default: 0,
      min: [0, "Credits cannot be negative."],
    },
    // Grade or semester where the subject is taught.
    // For Basic: 1-3 (secondary school grades)
    // For Upper Secondary: 1-6 (high school semesters)
    grade: {
      type: Number,
      enum: {
        values: [1, 2, 3, 4, 5, 6],
        message: "grade must be between 1 and 6.",
      },
      default: null,
    },
    // Optional description
    description: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
    // Active status (for "soft delete" of obsolete subjects)
    isActive: {
      type: Boolean,
      default: true,
    },
    // Whether this subject is Tutoría (homeroom/advisory).
    // The tutor is responsible for the group for the entire school year.
    isTutoria: {
      type: Boolean,
      default: false,
    },
    // Color hex para UI (front-end schedule, cards, etc.)
    color: {
      type: String,
      default: null,
      trim: true,
      match: [/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/, "Color must be a valid hex code."],
    },
    // Nombre del icono de lucide-react-native (ej: "Book", "Calculator")
    icon: {
      type: String,
      default: null,
      trim: true,
      maxlength: 50,
    },
    // Workshop offerings — only used when classificationType === "WORKSHOP".
    // Each entry represents a specific workshop the school offers
    // (e.g., "ELECTRONICA", "INFORMATICA").
    // When a school year is created/cloned, these are used to generate
    // Group(type: "taller") documents.
    workshops: [
      {
        name: {
          type: String,
          required: [true, "Workshop name is required."],
          trim: true,
          uppercase: true,
          maxlength: 80,
        },
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Unique code WITHIN the school
subjectSchema.index(
  { school: 1, code: 1 },
  { unique: true, name: "uniq_school_subject_code" }
);
// Search by name within the school. NOT unique on purpose: existing
// data may have duplicate names and a unique constraint would break
// migration. Deduplicating the catalog is a separate, manual task.
subjectSchema.index({ school: 1, name: 1 }, { name: "idx_school_subject_name" });
// Search by educational level within the school.
subjectSchema.index({ school: 1, educationalLevel: 1 }, { name: "idx_school_educational_level" });

const Subject = model("Subject", subjectSchema);

module.exports = Subject;
