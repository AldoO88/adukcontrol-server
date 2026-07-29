// Middleware de upload con Multer (memoryStorage)
// Procesa el archivo en memoria (buffer) y lo deja disponible en req.file.
// Útil cuando vamos a stream-earlo a un servicio externo (Cloudinary, S3, etc.)
// sin tocar el disco del servidor.
//
// Configuración:
//   - memoryStorage: el archivo se mantiene como Buffer en req.file.buffer
//   - fileFilter: solo imágenes JPEG, JPG, PNG, WebP
//   - limits.fileSize: 5 MB (configurable vía env si se necesita)
//
// Uso en una ruta:
//   router.post("/photo", uploadSingle("photo"), uploadController);
//
// Para procesar varios archivos:
//   router.post("/gallery", uploadArray("photos", 5), galleryController);
const multer = require("multer");

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml", // SVG: vectorial, común para escudos/logos
];

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_FILE_SIZE_LABEL = "5MB";

// Filtro: solo imágenes permitidas
const imageFileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(null, true);
  }
  // No es una imagen válida — rechazamos con un error
  const err = new Error(
    `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}.`
  );
  err.code = "INVALID_FILE_TYPE";
  return cb(err, false);
};

const storage = multer.memoryStorage();

const multerInstance = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1, // por defecto una sola imagen por request
  },
});

// Helpers exportados: multer directo y shortcuts con manejo de errores
const upload = multerInstance;

// Single file en un campo específico (default: "photo")
const uploadSingle = (fieldName = "photo") => {
  const mw = upload.single(fieldName);
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) return next();
      return handleMulterError(err, req, res, next);
    });
  };
};

// Multiple files en un campo (máximo `maxCount`)
const uploadArray = (fieldName = "photos", maxCount = 5) => {
  const mw = upload.array(fieldName, maxCount);
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) return next();
      return handleMulterError(err, req, res, next);
    });
  };
};

// Traduce errores de Multer a respuestas HTTP legibles.
// Si el error no es de Multer, lo propaga al siguiente middleware.
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: `File too large. Maximum size is ${MAX_FILE_SIZE_LABEL}.`,
      });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ message: "Too many files in request." });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res
        .status(400)
        .json({ message: `Unexpected file field: ${err.field}.` });
    }
    return res.status(400).json({ message: err.message });
  }
  if (err && err.code === "INVALID_FILE_TYPE") {
    return res.status(400).json({ message: err.message });
  }
  return next(err);
};

module.exports = {
  upload,
  uploadSingle,
  uploadArray,
  handleMulterError,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
};
