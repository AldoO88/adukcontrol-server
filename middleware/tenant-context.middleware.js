// Middlewares de contexto multi-tenant
// Inyectan el contexto de tenant (school, schoolYear, relación tutor-student)
// en `req` para que los controllers no tengan que repetir los lookups.
//
// Uso típico (en el orden correcto):
//   router.get(
//     "/me/students/:studentId/conduct-summary",
//     isAuthenticated,           // setea req.payload
//     attachSchoolContext,       // setea req.school desde el JWT
//     attachActiveSchoolYear,    // setea req.schoolYear (1 query)
//     requireGuardianOf,         // valida parentesco tutor-student (1 query)
//     getStudentConductSummary   // controller: SOLO lógica de negocio
//   );
//
// El controller puede entonces confiar en:
//   - req.school     → ObjectId (string) de la escuela del usuario
//   - req.schoolYear → ObjectId (string) del ciclo activo
//   - req.params.studentId → válido, pertenece a la escuela, y el caller es
//     Guardian del student
const mongoose = require("mongoose");
const School = require("../models/School.model");
const Guardian = require("../models/Guardian.model");

// ---------------------------------------------------------------------------
// attachSchoolContext
// ---------------------------------------------------------------------------
// Inyecta `req.school` con el School ID del JWT.
// Para super_admin (schoolId null en el JWT) devuelve 403: este middleware
// es para endpoints scoped a una escuela específica, no cross-tenant.
// Si el caller es un tutor y por algún motivo el JWT no trae schoolId,
// respondemos 500 (bug de signup).
const attachSchoolContext = (req, res, next) => {
  if (!req.payload) {
    return res.status(401).json({
      success: false,
      message: "attachSchoolContext requires isAuthenticated first.",
    });
  }
  const schoolId = req.payload.schoolId;
  if (!schoolId) {
    return res.status(403).json({
      success: false,
      message:
        "This endpoint requires a school-scoped user (tutor/staff). super_admin is not allowed.",
    });
  }
  req.school = String(schoolId);
  next();
};

// ---------------------------------------------------------------------------
// attachActiveSchoolYear
// ---------------------------------------------------------------------------
// Resuelve el ciclo escolar activo de la escuela y lo inyecta en `req.schoolYear`.
// Hace 1 query: School.findById(school).select("current_school_year_id").
// Si la escuela no tiene un ciclo activo configurado, devuelve 409.
// (Para super_admin con override, se podría aceptar ?school_year=...; no se
// implementa porque este middleware es para endpoints scoped a una escuela.)
const attachActiveSchoolYear = async (req, res, next) => {
  try {
    if (!req.school) {
      return res.status(500).json({
        success: false,
        message:
          "attachActiveSchoolYear requires attachSchoolContext first.",
      });
    }
    const school = await School.findById(req.school)
      .select("current_school_year_id")
      .lean();
    if (!school || !school.current_school_year_id) {
      return res.status(409).json({
        success: false,
        message: "No active school year configured for this school.",
      });
    }
    req.schoolYear = String(school.current_school_year_id);
    next();
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// requireGuardianOf
// ---------------------------------------------------------------------------
// Valida que el usuario autenticado es Guardian (tutor) del student en
// `req.params.studentId`. Hace el check multi-tenant en la misma query:
//   - user_id del JWT
//   - students array contiene el studentId
//   - school = req.school (filtrado por la escuela del tutor)
//
// Si pasa la validación, adjunta el doc del Guardian en `req.guardian` para
// que el controller pueda leer campos como `relationship` sin hacer una
// segunda query.
//
// Si el studentId no es un ObjectId válido → 404.
// Si no hay relación → 403 (el tutor no es Guardian de ese student).
//
// El check es estricto: NO basta con que el student exista en la escuela;
// el tutor tiene que estar explícitamente registrado como Guardian del
// student (lo cual garantiza la relación familiar/legal).
const requireGuardianOf = async (req, res, next) => {
  try {
    if (!req.school) {
      return res.status(500).json({
        success: false,
        message: "requireGuardianOf requires attachSchoolContext first.",
      });
    }
    const { studentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({
        success: false,
        message: `No student with id: ${studentId}`,
      });
    }
    const guardian = await Guardian.findOne({
      user_id: req.payload._id,
      students: studentId,
      school: req.school,
    }).lean();
    if (!guardian) {
      return res.status(403).json({
        success: false,
        message: "You are not a guardian of this student.",
      });
    }
    // Inyectamos el doc para que el controller no haga una 2da query
    req.guardian = guardian;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  attachSchoolContext,
  attachActiveSchoolYear,
  requireGuardianOf,
};
