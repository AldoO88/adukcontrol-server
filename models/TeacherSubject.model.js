// Modelo de Asignación Maestro-Materia-Grupo (TeacherSubject)
// Define QUÉ maestro enseña QUÉ materia a QUÉ grupo en QUÉ ciclo escolar.
// Es la "matriz" de permisos para que un teacher solo pueda calificar a
// los alumnos de los grupos donde efectivamente da clase.
//
// Ejemplo: Carlos (teacher) enseña Matemáticas a 2°B en 2024-2025:
//   { teacher_id: <carlos>, subject_id: <Matemáticas>, group_id: <2B-2024>, school_year_id: <2024-2025> }
//
// Si en 2025-2026 Carlos NO tiene un TeacherSubject para 2°B, no puede
// calificar a esos alumnos (el controller de Grade lo valida).
//
// BREAKING CHANGE: `subject: String` → `subject_id` (ref Subject). El campo
// era un String que se cruzaba a pelo contra `Grade.subject`; al pasar Grade
// a un ref, ese join dejaba de ser posible. Migrar con
// `node scripts/migrate-subjects-to-refs.js` ANTES de desplegar.
const { Schema, model } = require("mongoose");

const teacherSubjectSchema = new Schema(
  {
    // Tenant
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // El maestro
    teacher_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Teacher reference is required."],
      index: true,
    },
    // La materia del catálogo (ref Subject, igual que Grade.subject_id y
    // ClassSchedule.subject_id — las tres apuntan al mismo documento).
    subject_id: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      required: [true, "Subject reference is required."],
      index: true,
    },
    // El grupo al que enseña esta materia este maestro
    group_id: {
      type: Schema.Types.ObjectId,
      ref: "Group",
      required: [true, "Group reference is required."],
    },
    // Ciclo escolar (para que se pueda cambiar de año sin perder el histórico)
    school_year_id: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Un maestro no puede tener la misma materia duplicada en el mismo grupo+año.
// Sustituye a `uniq_teacher_subject_group_year`, que indexaba el `subject`
// String ya eliminado — lo dropea scripts/migrate-subjects-to-refs.js.
teacherSubjectSchema.index(
  { teacher_id: 1, subject_id: 1, group_id: 1, school_year_id: 1 },
  { unique: true, name: "uniq_teacher_subject_id_group_year" }
);
// Búsquedas: "qué materias enseña este maestro este año"
teacherSubjectSchema.index({ teacher_id: 1, school_year_id: 1 });
// Búsquedas: "qué maestros enseñan este grupo esta materia este año"
teacherSubjectSchema.index({ group_id: 1, subject_id: 1, school_year_id: 1 });

const TeacherSubject = model("TeacherSubject", teacherSubjectSchema);

module.exports = TeacherSubject;
