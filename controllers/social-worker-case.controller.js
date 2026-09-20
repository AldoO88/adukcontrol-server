// =====================================================================
// controllers/social-worker-case.controller.js
// ---------------------------------------------------------------------
// Controllers para los acuerdos con padres y referencias a
// instituciones del trabajador social.
//
// Endpoints:
//   - GET    /api/social-worker/students/:studentId/agreements
//   - POST   /api/social-worker/students/:studentId/agreements
//   - PATCH  /api/social-worker/agreements/:id
//   - GET    /api/social-worker/students/:studentId/referrals
//   - POST   /api/social-worker/students/:studentId/referrals
//   - PATCH  /api/social-worker/referrals/:id
// =====================================================================

const mongoose = require("mongoose");
const ParentAgreement = require("../models/ParentAgreement.model");
const InstitutionReferral = require("../models/InstitutionReferral.model");

// --- Helper de tenant filter ---
const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

// =====================================================================
// ACUERDOS CON PADRES
// =====================================================================

// GET /api/social-worker/students/:studentId/agreements
// Lista acuerdos de un alumno. Query params: ?status=active
const getAgreementsByStudent = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { status } = req.query;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: "Student not found." });
    }

    const filter = {
      ...tenantFilter(req),
      student_id: studentId,
    };
    if (status) filter.status = status;

    const agreements = await ParentAgreement.find(filter)
      .populate("reported_by", "name last_name role")
      .sort({ agreed_date: -1 })
      .lean();

    res.status(200).json(agreements);
  } catch (error) {
    next(error);
  }
};

// POST /api/social-worker/students/:studentId/agreements
// Crea un acuerdo para un alumno.
const createAgreement = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const {
      guardian_id,
      title,
      description,
      agreement_type,
      review_date,
      participants,
      notes,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: "Alumno no encontrado." });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "El título es requerido." });
    }

    const agreement = await ParentAgreement.create({
      school: req.payload.schoolId,
      student_id: studentId,
      guardian_id: guardian_id || null,
      title: title.trim(),
      description: description || null,
      agreement_type: agreement_type || "conducta",
      status: "active",
      agreed_date: new Date(),
      review_date: review_date || null,
      participants: participants || [],
      notes: notes || null,
      reported_by: req.payload._id,
    });

    const populated = await ParentAgreement.findById(agreement._id)
      .populate("reported_by", "name last_name role")
      .lean();

    res.status(201).json(populated);
  } catch (error) {
    next(error);
  }
};

// PATCH /api/social-worker/agreements/:id
// Actualiza un acuerdo (status, notas, review_date, etc.)
const updateAgreement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "Acuerdo no encontrado." });
    }

    const agreement = await ParentAgreement.findOne({
      _id: id,
      ...tenantFilter(req),
    });

    if (!agreement) {
      return res.status(404).json({ message: "Acuerdo no encontrado." });
    }

    // Campos permitidos para actualizar.
    const allowedFields = [
      "title",
      "description",
      "agreement_type",
      "status",
      "review_date",
      "participants",
      "notes",
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        agreement[field] = updates[field];
      }
    }

    await agreement.save();

    const populated = await ParentAgreement.findById(agreement._id)
      .populate("reported_by", "name last_name role")
      .lean();

    res.status(200).json(populated);
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// REFERENCIAS A INSTITUCIONES
// =====================================================================

// GET /api/social-worker/students/:studentId/referrals
// Lista referencias de un alumno. Query params: ?status=pending
const getReferralsByStudent = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const { status } = req.query;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: "Student not found." });
    }

    const filter = {
      ...tenantFilter(req),
      student_id: studentId,
    };
    if (status) filter.status = status;

    const referrals = await InstitutionReferral.find(filter)
      .populate("reported_by", "name last_name role")
      .sort({ referral_date: -1 })
      .lean();

    res.status(200).json(referrals);
  } catch (error) {
    next(error);
  }
};

// POST /api/social-worker/students/:studentId/referrals
// Crea una referencia para un alumno.
const createReferral = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const {
      institution_name,
      institution_type,
      contact_info,
      reason,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(404).json({ message: "Alumno no encontrado." });
    }

    if (!institution_name || !institution_name.trim()) {
      return res.status(400).json({ message: "El nombre de la institución es requerido." });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: "El motivo es requerido." });
    }

    const referral = await InstitutionReferral.create({
      school: req.payload.schoolId,
      student_id: studentId,
      institution_name: institution_name.trim(),
      institution_type: institution_type || "otro",
      contact_info: contact_info || null,
      reason: reason.trim(),
      status: "pending",
      referral_date: new Date(),
      reported_by: req.payload._id,
    });

    const populated = await InstitutionReferral.findById(referral._id)
      .populate("reported_by", "name last_name role")
      .lean();

    res.status(201).json(populated);
  } catch (error) {
    next(error);
  }
};

// PATCH /api/social-worker/referrals/:id
// Actualiza una referencia (status, response_notes, etc.)
const updateReferral = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "Referencia no encontrada." });
    }

    const referral = await InstitutionReferral.findOne({
      _id: id,
      ...tenantFilter(req),
    });

    if (!referral) {
      return res.status(404).json({ message: "Referencia no encontrada." });
    }

    // Campos permitidos para actualizar.
    const allowedFields = [
      "institution_name",
      "institution_type",
      "contact_info",
      "reason",
      "status",
      "response_date",
      "response_notes",
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        referral[field] = updates[field];
      }
    }

    await referral.save();

    const populated = await InstitutionReferral.findById(referral._id)
      .populate("reported_by", "name last_name role")
      .lean();

    res.status(200).json(populated);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAgreementsByStudent,
  createAgreement,
  updateAgreement,
  getReferralsByStudent,
  createReferral,
  updateReferral,
};
