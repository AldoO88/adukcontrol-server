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
    // Honorary name of the school (e.g. "José Clemente Orozco").
    // Some schools are named after illustrious people, e.g.
    // "Escuela Secundaria Técnica No. 47 — José Clemente Orozco".
    honoraryName: {
      type: String,
      trim: true,
      default: null,
    },
    // Physical address of the school.
    address: {
      type: String,
      trim: true,
      default: null,
    },
    // Phone number of the school.
    phoneNumber: {
      type: String,
      trim: true,
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
    // HTML template for credential generation.
    // The school uploads a custom HTML design with Handlebars placeholders
    // (e.g. {{student.first_name}}, {{school.name}}).
    // `layout` guarda el diseño del diseñador visual (drag & drop):
    //   { version, background: { type: "image"|"css"|"none", url?, css? },
    //     front: [Element], back: [Element] }
    // Las coordenadas (x, y, w, h) son px sobre un lienzo 816x1056
    // (Letter @96dpi), igual que al imprimir con Chrome.
    credentialTemplate: {
      html: { type: String, default: null },
      layout: { type: Schema.Types.Mixed, default: null },
      // Diseñador solo-PDF (CR80): PDF de fondo original en Cloudinary.
      pdf: { type: Schema.Types.Mixed, default: null },
      // Elementos dinámicos por página del PDF: [{ elements: [...] }].
      sides: { type: Schema.Types.Mixed, default: null },
      updatedAt: { type: Date, default: null },
    },
    // Credential configuration: logos, text, and design settings
    // used when rendering the credential templates.
    credentialConfig: {
      dgetLogoUrl: { type: String, default: null },
      iheLogoUrl: { type: String, default: null },
      watermarkUrl: { type: String, default: null },
      directorName: { type: String, default: null, trim: true },
      values: { type: String, default: null, trim: true },
      city: { type: String, default: null, trim: true },
      indications: { type: [String], default: [] },
      // Logos reusables del diseñador CR80 (subidos vía
      // /credential-template/logos, almacenados en Cloudinary). Mixed
      // porque la whitelist exacta se aplica en el controller al leerlos.
      logos: { type: Schema.Types.Mixed, default: null },
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
