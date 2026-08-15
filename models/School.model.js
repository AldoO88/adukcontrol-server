// School Model (Tenant)
// Represents a client school of the SaaS. In the multi-tenant architecture,
// each school isolates its own data: User, Student, AttendanceLog,
// Enrollment, Group, etc. belong to a single school.
// Golden rule: no query should return data from another school.
const { Schema, model } = require("mongoose");

const schoolSchema = new Schema(
  {
    // Official or commercial name of the school
    name: {
      type: String,
      required: [true, "School name is required."],
      trim: true,
    },
    // Public URL of the logo (optional; null until uploaded).
    // Updated via POST /api/schools/:schoolId/logo.
    logoUrl: {
      type: String,
      default: null,
      trim: true,
    },
    // Work Center Key (CCT) — official identifier from SEP.
    // Unique across the entire system, regardless of school.
    cct: {
      type: String,
      required: [true, "CCT is required."],
      unique: true, // Guarantees global CCT uniqueness
      trim: true,
      uppercase: true, // Normalize to uppercase
    },
    // Activation flag: allows logical deactivation without deleting the tenant
    isActive: {
      type: Boolean,
      default: true,
    },
    // Current school year of the school (reference to SchoolYear). It is
    // synchronized automatically via POST /api/school-years/:id/activate.
    // The dashboard and listings use this field to know "which year is current"
    // without having to query SchoolYear by isActive.
    current_school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      default: null,
    },
    // Educational levels offered by the school.
    // "BASIC" = Basic Education (NEM: Secondary)
    // "UPPER_SECONDARY" = Upper Secondary Education (MCCEMS: High School)
    // "HIGHER" = Higher Education (University)
    educationalLevels: {
      type: [String],
      enum: {
        values: ["BASIC", "UPPER_SECONDARY", "HIGHER"],
        message: "educationalLevel must be BASIC, UPPER_SECONDARY, or HIGHER.",
      },
      default: ["BASIC"],
      required: [true, "Educational levels are required."],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// cct already has an index via unique:true.
// We add an index on isActive to quickly filter active schools.
schoolSchema.index({ isActive: 1 });

const School = model("School", schoolSchema);

module.exports = School;
