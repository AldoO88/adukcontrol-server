// Controlador de Escuelas (Tenants)
// CRUD de los tenants del SaaS. Solo accesible para usuarios con role
// "super_admin". Las funciones administrativas de la plataforma (gestión de
// clientes, suspension, etc.) viven aquí.
const mongoose = require("mongoose");
const School = require("../models/School.model");
const User = require("../models/User.model");
const AssetVersion = require("../models/AssetVersion.model");
const {
  uploadBufferWithRetry,
  saveForRetry,
} = require("../services/cloudinary-upload.service");
const cloudinary = require("../config/cloudinary"); // para deleteSchoolLogo

// GET /api/schools
// Listar todas las escuelas (paginado, con búsqueda por nombre o CCT).
const getAllSchools = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, isActive } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = {};
    if (typeof isActive === "string") {
      filter.isActive = isActive === "true";
    }
    if (search) {
      const safe = String(search).trim();
      const regex = new RegExp(
        safe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      filter.$or = [{ name: regex }, { cct: regex }];
    }

    const skip = (pageNum - 1) * limitNum;
    const [items, total] = await Promise.all([
      School.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      School.countDocuments(filter),
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

// POST /api/schools
// Crea una nueva escuela (JSON puro, sin upload de archivos).
// La CCT debe ser única a nivel global.
//
// Para crear la escuela CON logo en un solo request, usar
//   POST /api/schools/with-logo  (multipart/form-data)
// Para actualizar/reemplazar el logo después, usar
//   POST /api/schools/:schoolId/logo  (multipart/form-data)
const createSchool = async (req, res, next) => {
  try {
    const { name, cct, isActive, honoraryName, address, phoneNumber } = req.body;

    if (!name || !cct) {
      return res
        .status(400)
        .json({ message: "name and cct are required." });
    }

    const newSchool = await School.create({
      name,
      cct,
      isActive,
      honoraryName,
      address,
      phoneNumber,
    });
    res.status(201).json(newSchool);
  } catch (error) {
    next(error);
  }
};

// Campos permitidos en PUT /api/schools/:schoolId.
// Por seguridad, ignoramos cualquier otro campo que mande el cliente.
// El `logoUrl` NO está acá: se actualiza únicamente vía
//   POST /api/schools/:schoolId/logo
// (es un archivo, no un campo string)
const ALLOWED_UPDATE_FIELDS = ["name", "cct", "isActive", "honoraryName", "address", "phoneNumber"];

// ----------------------------------------------------------------------------
// Helper privado: sube un logo a Cloudinary, crea la AssetVersion y devuelve
// el resultado. Usado por `uploadSchoolLogo` y `createSchoolWithLogo`.
//
// Comportamiento ante fallos:
//   - Si el upload falla tras todos los reintentos, el buffer se persiste a
//     disco (PENDING_UPLOADS_DIR) y se lanza un error con `err.queued = true`
//     y `err.path = <filePath>`. El caller decide cómo responder al cliente.
//   - NO modifica School.logoUrl ni crea la versión: lo hace el caller, para
//     que pueda decidir el orden (ej. createSchoolWithLogo primero guarda la
//     escuela y DESPUÉS sube el logo).
async function uploadLogoToCloudinary(school, file, uploadedByUserId) {
  // Folder por escuela para aislar assets en Cloudinary. Cada school tiene
  // su propia subcarpeta; esto facilita:
  //   - Listar/borrar todos los assets de una escuela
  //   - Auditoría: "qué tiene la escuela X en Cloudinary"
  //   - Multi-tenant: no hay leak accidental entre escuelas
  // eager_async + notification_url: si hay URL pública del backend, Cloudinary
  // procesa las transformaciones async y notifica por webhook cuando termina.
  const notificationUrl = process.env.CLOUDINARY_NOTIFICATION_URL
    ? `${process.env.CLOUDINARY_NOTIFICATION_URL}/api/webhooks/cloudinary`
    : null;

  const uploadOptions = {
    folder: `edukcontrol/schools/${school._id}/logos`,
    public_id: `logo_${school._id}_${Date.now()}`,
    overwrite: false,
    invalidate: true,
    resource_type: "image",
    transformation: [
      {
        width: 400,
        height: 400,
        crop: "fit",
        fetch_format: "auto",
        quality: "auto",
      },
    ],
    ...(notificationUrl
      ? { eager_async: true, notification_url: notificationUrl }
      : {}),
  };

  let result;
  try {
    result = await uploadBufferWithRetry(file.buffer, uploadOptions);
  } catch (err) {
    // Todos los reintentos fallaron → persistir a disco para reprocesar
    const saved = saveForRetry(file.buffer, uploadOptions, {
      entity_type: "school",
      entity_id: school._id.toString(),
      endpoint: "POST /api/schools/:schoolId/logo",
      uploaded_by: uploadedByUserId,
      lastError: err.message,
    });
    const e = new Error(
      "Upload failed after all retries. File queued for later retry."
    );
    e.queued = true;
    e.path = saved.filePath;
    throw e;
  }

  // Versionado: marcar la versión anterior como no-current y crear la nueva
  await AssetVersion.updateMany(
    { entity_type: "school", entity_id: school._id, is_current: true },
    { $set: { is_current: false } }
  );
  await AssetVersion.create({
    entity_type: "school",
    entity_id: school._id,
    public_id: result.public_id,
    url: result.secure_url,
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.bytes,
    is_current: true,
    uploaded_by: uploadedByUserId,
  });

  return result;
}

// POST /api/schools/with-logo
// Crea una escuela Y sube su logo en un solo request (multipart/form-data).
// Auth: super_admin.
// Body:
//   - name (string, required)
//   - cct (string, required, único global)
//   - isActive (boolean, optional, default true)
//   - logo (file, optional: JPEG/PNG/WebP/SVG, ≤5MB)
//
// Si la escuela se crea OK pero el upload del logo falla, la escuela QUEDA
// CREADA sin logo (devolvemos 201 con `logo_upload_error`). El front puede
// reintentar el logo vía POST /api/schools/:schoolId/logo. Decidimos esto en
// lugar de rollback porque perder la escuela por un fallo de upload es peor
// que tener que reintentar el logo (que es idempotente).
const createSchoolWithLogo = async (req, res, next) => {
  try {
    const { name, cct, isActive, honoraryName, address, phoneNumber } = req.body;

    if (!name || !cct) {
      return res
        .status(400)
        .json({ message: "name and cct are required." });
    }

    // 1. Crear la escuela (sin logo)
    const newSchool = await School.create({
      name,
      cct,
      isActive: isActive === undefined ? true : isActive,
      honoraryName: honoraryName || null,
      address: address || null,
      phoneNumber: phoneNumber || null,
    });

    // 2. Si NO viene logo, devolver 201 con la escuela creada
    if (!req.file || !req.file.buffer) {
      return res.status(201).json(newSchool);
    }

    // 3. Si viene logo, intentar subirlo (best-effort)
    try {
      const result = await uploadLogoToCloudinary(
        newSchool,
        req.file,
        req.payload._id
      );
      newSchool.logoUrl = result.secure_url;
      await newSchool.save();
      return res.status(201).json({
        school: newSchool,
        logo: {
          url: result.secure_url,
          public_id: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format,
          bytes: result.bytes,
        },
      });
    } catch (uploadErr) {
      // La escuela ya está creada; el logo falló. Devolvemos 201 con warning
      // para que el front sepa que la escuela existe pero el logo no.
      if (uploadErr && uploadErr.queued) {
        console.error(
          `[school-create-with-logo] Logo upload failed (queued for retry) for school ${newSchool._id}: ${uploadErr.path}`
        );
        return res.status(201).json({
          school: newSchool,
          logo_upload_error:
            "Logo upload failed after all retries; file queued for later retry. The school was created without a logo.",
          logo_queued: true,
        });
      }
      console.error(
        `[school-create-with-logo] Logo upload failed for school ${newSchool._id}: ${uploadErr.message}`
      );
      return res.status(201).json({
        school: newSchool,
        logo_upload_error:
          "Logo upload failed. The school was created without a logo. Retry via POST /api/schools/:schoolId/logo.",
      });
    }
  } catch (error) {
    next(error);
  }
};

// GET /api/schools/:schoolId
const getSchoolById = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    res.status(200).json(school);
  } catch (error) {
    next(error);
  }
};

// PUT /api/schools/:schoolId
// Actualiza solo los campos permitidos (name, isActive). El logo NO se
// modifica por acá: usar POST /api/schools/:schoolId/logo para subir uno
// nuevo, o DELETE /api/schools/:schoolId/logo para borrarlo.
const updateSchool = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    // Whitelist: ignorar cualquier campo que no esté en ALLOWED_UPDATE_FIELDS.
    // Esto previene:
    //   1. Que un cliente mande `logoUrl: "http://..."` pensando que el PUT
    //      sube archivos (no lo hace — el logo se maneja por su endpoint).
    //   2. Que un cliente modifique `cct` o `_id` (que también queremos
    //      inmutables post-creación).
    const update = {};
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (req.body[field] !== undefined) {
        update[field] = req.body[field];
      }
    }

    const updated = await School.findByIdAndUpdate(schoolId, update, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/schools/:schoolId
// Eliminación física. Generalmente se prefiere desactivar (isActive=false)
// para no romper el historial de datos de la escuela.
const deleteSchool = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    // Bloquear eliminación si hay usuarios o estudiantes asociados
    const [userCount, studentCount] = await Promise.all([
      User.countDocuments({ school: schoolId }),
      require("../models/Student.model").countDocuments({ school: schoolId }),
    ]);

    if (userCount > 0 || studentCount > 0) {
      return res.status(409).json({
        message: `Cannot delete school with associated data (${userCount} users, ${studentCount} students). Deactivate it instead.`,
      });
    }

    const deleted = await School.findByIdAndDelete(schoolId);
    if (!deleted) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    res.status(200).json({ message: "School deleted successfully" });
  } catch (error) {
    next(error);
  }
};

// POST /api/schools/:schoolId/logo
// Sube (o reemplaza) el logotipo de la escuela a Cloudinary.
// Transformaciones específicas para branding assets:
//   - crop: 'fit'   → no recorta, encaja dentro del bounding box
//   - fetch_format: 'auto' → sirve WebP/AVIF según el navegador (preserva PNG transparente)
//   - quality: 'auto' → compresión inteligente sin perder calidad percibida
// Auth: super_admin (validado en la ruta).
// Body: multipart/form-data con campo "logo" (JPEG/PNG/WebP/SVG, ≤5MB).
const uploadSchoolLogo = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: "No image file provided." });
    }

    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    try {
      const result = await uploadLogoToCloudinary(school, req.file, req.payload._id);
      school.logoUrl = result.secure_url;
      await school.save();
      res.status(200).json({
        message: "School logo uploaded successfully.",
        school,
        logo: {
          url: result.secure_url,
          public_id: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format,
          bytes: result.bytes,
        },
      });
    } catch (err) {
      if (err && err.queued) {
        return res.status(502).json({
          message: "Upload failed after all retries. File queued for later retry.",
          queued: true,
          path: err.path,
        });
      }
      throw err;
    }
  } catch (error) {
    next(error);
  }
};

// DELETE /api/schools/:schoolId/logo
// Elimina el logo de la escuela: borra TODAS las versiones de Cloudinary
// y limpia logoUrl en la DB.
// Auth: super_admin (validado en la ruta).
// Idempotente: si no hay logo, responde 200 con mensaje "No logo to delete".
//
// IMPORTANTE: borramos TODAS las versiones (no solo la current) usando los
// public_id guardados en AssetVersion. La versión anterior reconstruía
// el public_id como `edukcontrol/schools/logos/school_<id>`, que no
// coincide con el patrón real `edukcontrol/schools/<id>/logos/logo_<id>_<ts>`
// que usa uploadSchoolLogo, por lo que el destroy nunca matcheaba.
const deleteSchoolLogo = async (req, res, next) => {
  try {
    const { schoolId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    if (!school.logoUrl) {
      return res.status(200).json({ message: "No logo to delete." });
    }

    // Leer TODAS las versiones activas (no soft-deleted) de la DB
    const versions = await AssetVersion.find({
      entity_type: "school",
      entity_id: school._id,
      deletedAt: null,
    })
      .select("public_id")
      .lean();

    if (versions.length === 0) {
      // Caso raro: el logoUrl está seteado pero no hay AssetVersion
      // (data legacy, o se borró la colección). Limpiamos el campo
      // y dejamos Cloudinary como está (no sabemos qué public_id tenía).
      school.logoUrl = null;
      await school.save();
      return res.status(200).json({
        message:
          "School logoUrl cleared (no AssetVersion records found to delete from Cloudinary).",
        school,
        deleted_versions: 0,
      });
    }

    // Borrar cada asset de Cloudinary. Si alguno falla, logueamos pero
    // seguimos con los demás — la prioridad es limpiar TODOS los assets.
    const destroyErrors = [];
    for (const v of versions) {
      try {
        const r = await cloudinary.uploader.destroy(v.public_id, {
          invalidate: true, // purga la CDN cache
        });
        // "ok" o "not found" son ambos aceptables (idempotencia)
        if (r.result !== "ok" && r.result !== "not found") {
          destroyErrors.push({ public_id: v.public_id, result: r.result });
        }
      } catch (e) {
        destroyErrors.push({ public_id: v.public_id, error: e.message });
      }
    }
    if (destroyErrors.length > 0) {
      console.warn(
        `[schools] Some logos failed to delete from Cloudinary:`,
        destroyErrors
      );
    }

    // Soft-delete las versiones en DB (mantiene historial para auditoría)
    await AssetVersion.updateMany(
      { entity_type: "school", entity_id: school._id, deletedAt: null },
      { $set: { deletedAt: new Date() } }
    );

    // Limpiar el campo logoUrl
    school.logoUrl = null;
    await school.save();

    res.status(200).json({
      message: "School logo deleted successfully.",
      school,
      deleted_versions: versions.length,
      ...(destroyErrors.length > 0
        ? { cloudinary_errors: destroyErrors }
        : {}),
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/schools/:schoolId/logo/versions
// Lista el historial de versiones del logo, ordenadas de más reciente a más vieja.
// Excluye soft-deleted por default.
const getSchoolLogoVersions = async (req, res, next) => {
  try {
    const { schoolId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }
    const versions = await AssetVersion.find({
      entity_type: "school",
      entity_id: schoolId,
      deletedAt: null,
    })
      .sort({ createdAt: -1 })
      .populate("uploaded_by", "name email role");
    res.status(200).json({
      items: versions,
      total: versions.length,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/schools/:schoolId/logo/rollback
// Body: { version_id } — set una versión anterior como current.
// Actualiza School.logoUrl y marca la versión como is_current=true (y las demás false).
const rollbackSchoolLogo = async (req, res, next) => {
  try {
    const { schoolId } = req.params;
    const { version_id } = req.body;
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }
    if (!version_id || !mongoose.Types.ObjectId.isValid(version_id)) {
      return res.status(400).json({ message: "Valid version_id is required." });
    }

    const target = await AssetVersion.findOne({
      _id: version_id,
      entity_type: "school",
      entity_id: schoolId,
    });
    if (!target) {
      return res.status(404).json({ message: "Version not found for this school." });
    }

    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(404).json({ message: `No school with id: ${schoolId}` });
    }

    // Swap: marcar todas como no-current, luego la target como current
    await AssetVersion.updateMany(
      { entity_type: "school", entity_id: schoolId, is_current: true },
      { $set: { is_current: false } }
    );
    target.is_current = true;
    await target.save();

    school.logoUrl = target.url;
    await school.save();

    res.status(200).json({
      message: "School logo rolled back successfully.",
      school,
      current_version: target,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllSchools,
  createSchool,
  createSchoolWithLogo,
  getSchoolById,
  updateSchool,
  deleteSchool,
  uploadSchoolLogo,
  deleteSchoolLogo,
  getSchoolLogoVersions,
  rollbackSchoolLogo,
};
