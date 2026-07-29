// Controlador de Configuración de Conducta (ConductConfig)
// Una sola config por escuela. Si nunca se creó, el servicio devuelve
// los defaults en lectura (no es obligatorio tener el documento para
// que el sistema funcione).
const mongoose = require("mongoose");
const ConductConfig = require("../models/ConductConfig.model");
const School = require("../models/School.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

const { getConductConfig } = require("../services/conduct.service");

// GET /api/conduct-config
// Devuelve la config efectiva de la escuela (mezcla con defaults si
// no existe el documento).
const getConfig = async (req, res, next) => {
  try {
    const schoolId =
      req.payload.role === "super_admin"
        ? req.query.school_id
        : req.payload.schoolId;
    if (!schoolId) {
      return res
        .status(400)
        .json({ message: "school_id is required (query param for super_admin)." });
    }
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ message: "Invalid school_id." });
    }
    const config = await getConductConfig(schoolId);
    res.status(200).json({ school: schoolId, ...config });
  } catch (error) {
    next(error);
  }
};

// PUT /api/conduct-config
// Crea o actualiza la config de la escuela. Solo admin/registrar/super_admin.
// Body: { weights?: { minor, moderate, severe }, baseline?, floor?, school? }
const upsertConfig = async (req, res, next) => {
  try {
    // School destino: del JWT, o del body si es super_admin
    const schoolId =
      req.payload.role === "super_admin"
        ? req.body.school
        : req.payload.schoolId;
    if (!schoolId) {
      return res.status(400).json({
        message:
          "school is required (in body for super_admin, in JWT otherwise).",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(400).json({ message: "Invalid school id." });
    }

    // Validar que la escuela existe
    const school = await School.findById(schoolId).select("_id").lean();
    if (!school) {
      return res.status(404).json({ message: "School not found." });
    }

    // Validar payload
    const { weights, baseline, floor } = req.body;
    if (weights !== undefined) {
      if (typeof weights !== "object" || weights === null) {
        return res
          .status(400)
          .json({ message: "weights must be an object." });
      }
      for (const sev of ["minor", "moderate", "severe"]) {
        if (
          weights[sev] !== undefined &&
          (typeof weights[sev] !== "number" || weights[sev] < 0)
        ) {
          return res.status(400).json({
            message: `weights.${sev} must be a non-negative number.`,
          });
        }
      }
    }
    if (baseline !== undefined && (typeof baseline !== "number" || baseline < 0)) {
      return res
        .status(400)
        .json({ message: "baseline must be a non-negative number." });
    }
    if (floor !== undefined && (typeof floor !== "number" || floor < 0)) {
      return res
        .status(400)
        .json({ message: "floor must be a non-negative number." });
    }

    // upsert (un doc por escuela, indexado por school)
    const update = {};
    if (weights !== undefined) {
      // Solo los campos provistos
      for (const sev of ["minor", "moderate", "severe"]) {
        if (weights[sev] !== undefined) {
          update[`weights.${sev}`] = weights[sev];
        }
      }
    }
    if (baseline !== undefined) update.baseline = baseline;
    if (floor !== undefined) update.floor = floor;

    const config = await ConductConfig.findOneAndUpdate(
      { school: schoolId },
      { $set: update, $setOnInsert: { school: schoolId } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      message: "Conduct config saved successfully.",
      config,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getConfig,
  upsertConfig,
};
