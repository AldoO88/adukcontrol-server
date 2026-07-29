// Configuración del SDK de Cloudinary.
// Se inicializa una sola vez al importarse este módulo.
// Las credenciales vienen de variables de entorno (NO hardcodear).
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // Devuelve https:// en todas las URLs
});

// Estructura de carpetas en Cloudinary (multi-tenant):
//   edukcontrol/schools/<school._id>/logos/logo_<school._id>_<ts>
//   edukcontrol/schools/<school._id>/students/photo_<student._id>_<ts>
//
// Cada escuela tiene su propia subcarpeta. Esto permite:
//   - Listar todos los assets de una escuela con un solo prefix
//   - Borrar todos los assets de una escuela con delete_folder
//   - Auditoría: ver qué tiene cada escuela en Cloudinary
//   - No hay leak accidental entre escuelas
const FOLDERS = {
  schoolLogos: (schoolId) => `edukcontrol/schools/${schoolId}/logos`,
  studentPhotos: (schoolId) => `edukcontrol/schools/${schoolId}/students`,
  rootPrefix: "edukcontrol/schools/",
};

module.exports = cloudinary;
module.exports.FOLDERS = FOLDERS;
