// Modelo de Citatorio (Citation / Meeting)
// Cita formal que requiere la presencia de un padre/tutor en la escuela
// respecto a un alumno. Es un workflow BIDIRECCIONAL (escuela → tutor) con
// estado rastreable: pendiente → confirmado → completado | no_show.
//
// Se mantiene COMPLETAMENTE SEPARADO de Announcement porque:
//   - Announcement es unidireccional (escuela → muchos), sin horario.
//   - Citation requiere fecha/hora concreta, razón, y un ciclo de status.
//
// =====================================================================
// RECORDATORIO PARA EL DESARROLLADOR DEL CONTROLLER (NO BORRAR)
// =====================================================================
// La validación de QUIÉN puede crear citarios NO vive acá (es policy,
// no integridad de datos). El controller DEBE aplicar estas reglas
// ANTES de hacer `Citation.create(...)`:
//
//   1. `principal`, `social_worker`, `prefect`  →  alcance escolar completo.
//      Pueden citar a cualquier alumno de la escuela.
//
//   2. `teacher`  →  alcance limitado: solo puede citar a alumnos que
//      estén inscritos en uno de los grupos donde tiene una asignación
//      activa de TeacherSubject. Esto se valida cruzando:
//        - el grupo de la Enrollment activa del student
//        - las TeacherSubject del teacher_id autenticado
//        - que coincidan school_year_id y group_id
//      Si el alumno NO está en un grupo suyo, responder 403.
//
//   3. `admin` / `registrar`  →  alcance escolar completo (mismo caso
//      que principal).
//
//   4. `super_admin`  →  bypass total (cross-tenant).
//
// Otras validaciones de negocio que también van en el controller:
//   - `scheduledDate` no puede ser en el pasado (salvo casos
//     administrativos especiales que el admin podría permitir).
//   - El `student` y `creator` deben pertenecer a la misma escuela
//     (chequeo multi-tenant).
//   - El `student` debe tener al menos un Guardian asociado (sin
//     tutor no se puede citar). Si no tiene, responder 409.
// =====================================================================
const { Schema, model } = require("mongoose");

const citationSchema = new Schema(
  {
    // -------- Tenant & Contexto --------
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: [true, "School reference is required."],
      index: true,
    },
    // Ciclo escolar del citatorio. Permite separar visualmente los
    // citatorios del ciclo actual vs histórico en los listados.
    schoolYear: {
      type: Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: [true, "School year reference is required."],
      index: true,
    },

    // -------- Actores --------
    // Alumno citado (el tema del citatorio gira en torno a él).
    student: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student reference is required."],
      index: true,
    },
    // Staff que emite el citatorio (teacher, prefect, social_worker,
    // principal, admin, registrar). El controller valida el alcance.
    creator: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Creator is required."],
    },

    // -------- Detalles de la cita --------
    // Fecha Y hora en que se espera al padre/tutor. Se guarda como
    // Date completo (no solo YYYY-MM-DD) para soportar franjas
    // horarias ("lunes 14 de marzo, 10:30").
    scheduledDate: {
      type: Date,
      required: [true, "scheduledDate is required."],
    },
    // Lugar físico donde se presentará el tutor (ej. Taller de Ofimática, Dirección, etc.)
      location: {
        type: String,
        required: [true, "location is required."],
        trim: true,
      },
    // Tipo de citatorio. Útil para filtrar y para elegir la plantilla
    // del mensaje que se envía al tutor.
    type: {
      type: String,
      required: [true, "type is required."],
      enum: {
        values: ["academic", "behavioral", "administrative"],
        message: "type must be: academic, behavioral or administrative.",
      },
    },
    // Razón breve y visible para el tutor. Se muestra en el push
    // notification y en el listado de "citas pendientes" del front.
    reason: {
      type: String,
      required: [true, "reason is required."],
      trim: true,
      maxlength: 1000,
    },
    // Materia relacionada con el citatorio (opcional). Útil cuando un
    // maestro imparte varias materias al mismo grupo y el problema es
    // específico de una materia.
    subject: {
      type: Schema.Types.ObjectId,
      ref: "Subject",
      default: null,
    },

    // -------- Tracking del workflow --------
    // pending    → creado, aún no confirmado por el tutor
    // confirmed  → el tutor confirmó que asistirá
    // completed  → la reunión ocurrió (el staff la marca al terminar)
    // no_show    → el tutor no se presentó (automático por cron o manual)
    // expired    → (reservado, no usado actualmente)
    // cancelled  → el citatorio fue cancelado por el teacher o admin
    status: {
      type: String,
      required: [true, "status is required."],
      enum: {
        values: ["pending", "confirmed", "completed", "no_show", "expired", "cancelled"],
        message: "status must be: pending, confirmed, completed, no_show, expired or cancelled.",
      },
      default: "pending",
      index: true,
    },

    // -------- Reagendación --------
    // Marca si el tutor solicitó reagendar la cita. El teacher ve este
    // flag en su listado y sabe que debe proponer una nueva fecha.
    rescheduleRequested: {
      type: Boolean,
      default: false,
    },
    // Razón del tutor para solicitar reagendación.
    rescheduleReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// -------- Índices compuestos --------
// Patrón admin: "todos los citatorios de mi escuela en este ciclo, filtrados
// por status" (ej. el panel del director ve "todos los pendientes del mes").
citationSchema.index(
  { school: 1, schoolYear: 1, status: 1 },
  { name: "idx_school_year_status" }
);
// Patrón tutor (app móvil): "todos los citatorios de MI hijo, filtrados
// por status" (ej. "mostrame los pendientes" en la pantalla del tutor).
citationSchema.index(
  { student: 1, status: 1 },
  { name: "idx_student_status" }
);

const Citation = model("Citation", citationSchema);
module.exports = Citation;
