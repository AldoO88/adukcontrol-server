// Controlador de Citation (Citatorio)
// CRUD staff para citatorios formales (reunión obligatoria con un
// padre/tutor sobre un alumno). El tutor CONSUME los citatorios vía el
// feed unificado `GET /api/guardians/me/announcements` (mezclados con los
// avisos); este controller es la cara de ESCRITURA del recurso.
//
// Multi-tenant estricto: cada query filtra por la escuela del usuario.
// super_admin puede operar cross-tenant (debe especificar `school` en el
// body al crear).
//
// Reglas de alcance (validadas en este controller, no en el modelo — la
// DB solo persiste el resultado, como dice el comentario del modelo):
//   - admin / principal / registrar / super_admin  → alcance completo
//   - prefect / social_worker                       → alcance completo
//   - teacher                                       → alcance limitado:
//     solo puede citar a alumnos inscritos en grupos donde tiene un
//     TeacherSubject activo en el schoolYear del citatorio.
//
// Restricciones de negocio (validadas acá, NO en el modelo):
//   - El student DEBE tener al menos un Guardian asociado (sin tutor no
//     se puede citar) → 409 si no tiene.
//   - `scheduledDate` no puede ser en el pasado, salvo para roles
//     administrativos (admin/principal/registrar/super_admin) que
//     podrían necesitar citatorios retroactivos.
const mongoose = require("mongoose");
const Citation = require("../models/Citation.model");
const Student = require("../models/Student.model");
const School = require("../models/School.model");
const TeacherSubject = require("../models/TeacherSubject.model");
const Enrollment = require("../models/Enrollment.model");
const Guardian = require("../models/Guardian.model");
const notificationService = require("../services/notification.service");

const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

// Roles que pueden crear / editar citatorios. La validación fina del
// alcance del teacher se hace en `validateTeacherScopeForStudent`.
const REPORTER_ROLES = [
  "admin",
  "principal",
  "registrar",
  "teacher",
  "prefect",
  "social_worker",
  "super_admin",
];

const ADMIN_ROLES = ["admin", "principal", "registrar", "super_admin"];

const STAFF_ROLES = [
  "admin",
  "principal",
  "registrar",
  "teacher",
  "prefect",
  "social_worker",
  "super_admin",
];

// Resuelve el ciclo escolar activo de una escuela. Devuelve null si no
// hay uno configurado (el caller debe responder 409 en ese caso).
const resolveActiveSchoolYear = async (schoolId) => {
  if (!schoolId) return null;
  const school = await School.findById(schoolId)
    .select("current_school_year_id")
    .lean();
  if (!school || !school.current_school_year_id) return null;
  return String(school.current_school_year_id);
};

// Valida que el teacher pueda citar al student: el student debe estar
// inscrito en un grupo donde el teacher tiene TeacherSubject activo en
// el schoolYear del citatorio.
const validateTeacherScopeForStudent = async (
  teacherId,
  schoolId,
  schoolYearId,
  studentId
) => {
  // 1) Grupos del teacher en este ciclo.
  const teacherSubjects = await TeacherSubject.find({
    teacher_id: teacherId,
    school: schoolId,
    school_year_id: schoolYearId,
  })
    .select("group_id")
    .lean();
  const teacherGroupIds = new Set(
    teacherSubjects.map((ts) => String(ts.group_id))
  );
  if (teacherGroupIds.size === 0) {
    return {
      valid: false,
      message: "You have no group assignments in this school year.",
    };
  }

  // 2) Enrollment del student en este ciclo (source of truth del grupo).
  const enrollment = await Enrollment.findOne({
    student_id: studentId,
    school: schoolId,
    school_year_id: schoolYearId,
  })
    .select("group_id")
    .lean();
  if (!enrollment) {
    return {
      valid: false,
      message: "Student has no enrollment in this school year.",
    };
  }
  if (!teacherGroupIds.has(String(enrollment.group_id))) {
    return {
      valid: false,
      message: "You can only cite students in groups you teach.",
    };
  }
  return { valid: true };
};

// Helper: popula los campos estándar del citatorio para devolver en la
// respuesta (student, creator, schoolYear).
const populateCitation = (query) =>
  query
    .populate("student", "first_name last_name photoUrl controlNumber")
    .populate("creator", "name last_name role")
    .populate("schoolYear", "name startDate endDate isActive");

// =====================================================================
// POST /api/citations
// Crea un citatorio. Body:
//   {
//     student:       ObjectId (required)
//     scheduledDate: ISO date (required)
//     type:          "academic" | "behavioral" | "administrative" (required)
//     reason:        string, max 1000 chars (required)
//     schoolYear:    ObjectId (default al ciclo activo)
//     school:        ObjectId (solo super_admin; default su JWT schoolId)
//   }
const createCitation = async (req, res, next) => {
  try {
    const isSuperAdmin = req.payload.role === "super_admin";
    const { student: studentId, scheduledDate, type, reason, schoolYear } =
      req.body;

    // 1) School.
    const school = isSuperAdmin ? req.body.school : req.payload.schoolId;
    if (!school) {
      return res.status(400).json({ message: "school is required." });
    }
    if (!mongoose.Types.ObjectId.isValid(school)) {
      return res.status(400).json({ message: "Invalid school id." });
    }

    // 2) Validar student: debe existir y pertenecer a la misma escuela.
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ message: "Valid student is required." });
    }
    const student = await Student.findOne({ _id: studentId, school })
      .select("_id first_name last_name")
      .lean();
    if (!student) {
      return res
        .status(404)
        .json({ message: "Student not found in this school." });
    }

    // 3) El student debe tener al menos un Guardian (sin tutor no se
    //    puede citar) — regla de negocio del comentario del modelo.
    const guardianCount = await Guardian.countDocuments({
      students: studentId,
      school,
    });
    if (guardianCount === 0) {
      return res.status(409).json({
        message:
          "Student has no guardians registered. Cannot create a citation without a tutor.",
      });
    }

    // 4) SchoolYear.
    let schoolYearId = schoolYear;
    if (!schoolYearId) {
      schoolYearId = await resolveActiveSchoolYear(school);
      if (!schoolYearId) {
        return res.status(409).json({
          message: "No active school year configured for this school.",
        });
      }
    }
    if (!mongoose.Types.ObjectId.isValid(schoolYearId)) {
      return res.status(400).json({ message: "Invalid schoolYear." });
    }

    // 5) Validar scheduledDate.
    if (!scheduledDate) {
      return res.status(400).json({ message: "scheduledDate is required." });
    }
    const scheduledDateObj = new Date(scheduledDate);
    if (Number.isNaN(scheduledDateObj.getTime())) {
      return res
        .status(400)
        .json({ message: "scheduledDate is not a valid ISO date." });
    }
    // No se rechaza `scheduledDate` en el pasado. El acceso a este endpoint
    // ya está restringido a REPORTER_ROLES vía el router, así que cualquier
    // staff puede crear citatorios con cualquier fecha — útil para
    // documentar reuniones que ya pasaron (e.g. el staff olvidó crearlo
    // en el momento, o el padre se presentó sin cita previa).
    // El feed del tutor (`/me/announcements`) sigue filtrando por status
    // pending/confirmed, así que un citatorio con fecha muy vieja no satura
    // el feed a menos que siga activo.

    // 6) Validar type.
    if (!["academic", "behavioral", "administrative"].includes(type)) {
      return res.status(400).json({
        message:
          'type must be "academic", "behavioral" or "administrative".',
      });
    }

    // 7) Validar reason.
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: "reason is required." });
    }
    const reasonTrim = String(reason).trim();
    if (reasonTrim.length > 1000) {
      return res
        .status(400)
        .json({ message: "reason must be at most 1000 characters." });
    }

    // 8) Validar el alcance del teacher (si aplica).
    if (req.payload.role === "teacher") {
      const scopeCheck = await validateTeacherScopeForStudent(
        req.payload._id,
        school,
        schoolYearId,
        studentId
      );
      if (!scopeCheck.valid) {
        return res.status(403).json({ message: scopeCheck.message });
      }
    }

    // 9) Crear el doc.
    const citation = await Citation.create({
      school,
      schoolYear: schoolYearId,
      student: studentId,
      creator: req.payload._id,
      scheduledDate: scheduledDateObj,
      type,
      reason: reasonTrim,
      status: "pending",
    });

    // 10) Devolver con populate.
    const populated = await populateCitation(
      Citation.findById(citation._id)
    ).lean();

    // 11) Disparar push a los tutores del student (async, después del 201).
    //     El device obtiene una respuesta rápida; las notificaciones se
    //     procesan en background vía process.nextTick (mismo patrón que
    //     attendance.controller.js).
    process.nextTick(() => {
      (async () => {
        try {
          const result = await notificationService.sendCitationNotification(
            populated
          );
          if (result && result.dispatched > 0) {
            console.log(
              `[citations] Push notifications dispatched for citation ${populated._id} (${result.dispatched}/${result.tokens || 0})`
            );
          } else {
            console.log(
              `[citations] No push notifications dispatched for citation ${populated._id}: ${
                result && result.reason ? result.reason : "unknown"
              }`
            );
          }
        } catch (err) {
          console.error(
            `[citations] Background notification error for citation ${populated._id}: ${err.message}`
          );
        }
      })();
    });

    res.status(201).json(populated);
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// GET /api/citations
// Lista paginada. Staff únicamente. Filtros:
//   - status      ("pending" | "confirmed" | "completed" | "no_show")
//   - type        ("academic" | "behavioral" | "administrative")
//   - student     (ObjectId)
//   - creator     (ObjectId)
//   - schoolYear  (ObjectId; default = ciclo activo)
//   - from, to    (rango sobre scheduledDate)
//   - page, limit (limit max 100)
const getAllCitations = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      type,
      student,
      creator,
      schoolYear,
      from,
      to,
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const filter = { ...tenantFilter(req) };

    if (status) {
      if (!["pending", "confirmed", "completed", "no_show"].includes(status)) {
        return res.status(400).json({
          message:
            'status must be "pending", "confirmed", "completed" or "no_show".',
        });
      }
      filter.status = status;
    }
    if (type) {
      if (!["academic", "behavioral", "administrative"].includes(type)) {
        return res.status(400).json({
          message:
            'type must be "academic", "behavioral" or "administrative".',
        });
      }
      filter.type = type;
    }
    if (student && mongoose.Types.ObjectId.isValid(student)) {
      filter.student = student;
    }
    if (creator && mongoose.Types.ObjectId.isValid(creator)) {
      filter.creator = creator;
    }
    if (schoolYear && mongoose.Types.ObjectId.isValid(schoolYear)) {
      filter.schoolYear = schoolYear;
    } else if (req.payload.schoolId) {
      const activeSY = await resolveActiveSchoolYear(req.payload.schoolId);
      if (activeSY) filter.schoolYear = activeSY;
    }
    if (from || to) {
      filter.scheduledDate = {};
      if (from) {
        const d = new Date(from);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "from is not a valid date." });
        }
        filter.scheduledDate.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "to is not a valid date." });
        }
        filter.scheduledDate.$lte = d;
      }
    }

    const [items, total] = await Promise.all([
      populateCitation(Citation.find(filter))
        .sort({ scheduledDate: -1 })
        .skip(skip)
        .limit(limitNum),
      Citation.countDocuments(filter),
    ]);

    res.status(200).json({
      items,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum) || 1,
    });
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// GET /api/citations/:id
// Detalle de un citatorio. Staff únicamente.
const getCitationById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: `No citation with id: ${id}` });
    }

    const citation = await populateCitation(
      Citation.findOne({ _id: id, ...tenantFilter(req) })
    ).lean();

    if (!citation) {
      return res.status(404).json({ message: `No citation with id: ${id}` });
    }

    res.status(200).json(citation);
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// PATCH /api/citations/:id/status
// Cambia el status del citatorio. Body: { status: "pending" | "confirmed" | "completed" | "no_show" }
//
// Transiciones válidas:
//   pending    → confirmed | completed | no_show
//   confirmed  → completed | no_show
//   completed  → (terminal, no se puede cambiar)
//   no_show    → (terminal, no se puede cambiar)
//
// Staff puede hacer cualquier transición válida. El tutor usa otro
// endpoint (futuro) para `pending → confirmed` desde la app móvil.
const updateCitationStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: `No citation with id: ${id}` });
    }

    if (!["pending", "confirmed", "completed", "no_show"].includes(status)) {
      return res.status(400).json({
        message:
          'status must be "pending", "confirmed", "completed" or "no_show".',
      });
    }

    const existing = await Citation.findOne({
      _id: id,
      ...tenantFilter(req),
    });
    if (!existing) {
      return res.status(404).json({ message: `No citation with id: ${id}` });
    }

    const validTransitions = {
      pending: ["confirmed", "completed", "no_show"],
      confirmed: ["completed", "no_show"],
      completed: [],
      no_show: [],
    };

    if (!validTransitions[existing.status].includes(status)) {
      return res.status(409).json({
        message: `Invalid status transition: ${existing.status} → ${status}.`,
      });
    }

    existing.status = status;
    await existing.save();

    const populated = await populateCitation(
      Citation.findById(existing._id)
    ).lean();
    res.status(200).json(populated);
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// DELETE /api/citations/:id
// Borrado físico. Solo super_admin (auditoría). El flujo normal es
// cambiar el status a completed/no_show; el borrado es de emergencia.
const deleteCitation = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: `No citation with id: ${id}` });
    }

    const existing = await Citation.findOne({
      _id: id,
      ...tenantFilter(req),
    });
    if (!existing) {
      return res.status(404).json({ message: `No citation with id: ${id}` });
    }

    await existing.deleteOne();
    res.status(200).json({ message: "Citation deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCitation,
  getAllCitations,
  getCitationById,
  updateCitationStatus,
  deleteCitation,
  REPORTER_ROLES,
  ADMIN_ROLES,
  STAFF_ROLES,
};
