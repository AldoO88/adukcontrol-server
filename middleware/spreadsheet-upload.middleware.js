// Middleware de upload de archivos XLSX para carga masiva.
// memoryStorage con fileFilter que acepta Excel (.xlsx, .xls, .csv).
// Tamaño máx 10MB (los Excels grandes son válidos).

const multer = require("multer");

const ALLOWED_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/octet-stream", // algunos browsers mandan este para .xlsx
  "text/csv", // .csv
  "application/vnd.ms-excel.sheet.macroenabled.12", // .xlsm
];

const ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".csv", ".xlsm"];

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const spreadsheetFileFilter = (req, file, cb) => {
  const ext = (file.originalname || "").toLowerCase();
  const hasValidExt = ALLOWED_EXTENSIONS.some((e) => ext.endsWith(e));
  const hasValidMime = ALLOWED_MIME_TYPES.includes(file.mimetype);

  if (hasValidExt || hasValidMime) {
    return cb(null, true);
  }

  const err = new Error(
    `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`
  );
  err.code = "INVALID_FILE_TYPE";
  return cb(err, false);
};

const storage = multer.memoryStorage();

const multerInstance = multer({
  storage,
  fileFilter: spreadsheetFileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
});

const uploadSpreadsheetSingle = (fieldName = "file") => {
  const mw = multerInstance.single(fieldName);
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            message: `File too large. Maximum size is 10MB.`,
          });
        }
        return res.status(400).json({ message: err.message });
      }
      if (err && err.code === "INVALID_FILE_TYPE") {
        return res.status(400).json({ message: err.message });
      }
      return next(err);
    });
  };
};

module.exports = {
  uploadSpreadsheetSingle,
};
