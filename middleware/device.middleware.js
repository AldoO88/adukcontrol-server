// Middleware de autenticación de dispositivo
// Verifica que la petición venga de un dispositivo físico autorizado
// (lector RFID, cámara facial, etc.) usando una API key compartida.
//
// La API key puede llegar en:
//   - Cabecera "X-Device-Api-Key"
//   - Cabecera "X-Api-Key"
//   - Campo "api_key" en el body
//
// La comparación se hace con crypto.timingSafeEqual para evitar timing attacks.
const crypto = require("crypto");

const verifyDeviceApiKey = (req, res, next) => {
  // Secreto configurado en el servidor (variable de entorno)
  const expected = process.env.DEVICE_TRIGGER_API_KEY;

  if (!expected) {
    // El servidor no está configurado para aceptar peticiones de dispositivos
    return res
      .status(500)
      .json({ message: "Device API key is not configured on the server." });
  }

  // Buscar la API key en cabeceras o en el body
  const provided =
    req.headers["x-device-api-key"] ||
    req.headers["x-api-key"] ||
    (req.body && req.body.api_key);

  if (!provided) {
    return res.status(401).json({ message: "Missing device API key header." });
  }

  // Comparación en tiempo constante
  let equal = false;
  try {
    const a = Buffer.from(String(provided), "utf8");
    const b = Buffer.from(String(expected), "utf8");
    if (a.length === b.length) {
      // Solo se puede comparar si las longitudes coinciden
      equal = crypto.timingSafeEqual(a, b);
    }
  } catch (e) {
    equal = false;
  }

  if (!equal) {
    return res.status(401).json({ message: "Invalid device API key." });
  }

  return next();
};

module.exports = { verifyDeviceApiKey };
