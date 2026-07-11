const crypto = require("crypto"); // Crypto de Node para timingSafeEqual

const verifyDeviceApiKey = (req, res, next) => { // Middleware de autenticación de dispositivo
  const expected = process.env.DEVICE_TRIGGER_API_KEY; // Secreto del servidor

  if (!expected) { // No configurado
    return res // 500
      .status(500)
      .json({ message: "Device API key is not configured on the server." });
  }

  const provided = // Buscar en cabeceras o cuerpo
    req.headers["x-device-api-key"] ||
    req.headers["x-api-key"] ||
    (req.body && req.body.api_key);

  if (!provided) { // Falta el token
    return res.status(401).json({ message: "Missing device API key header." }); // 401
  }

  let equal = false; // Por defecto no coincide
  try { // Proteger contra entradas extrañas
    const a = Buffer.from(String(provided), "utf8"); // Bytes del cliente
    const b = Buffer.from(String(expected), "utf8"); // Bytes del servidor
    if (a.length === b.length) { // Las longitudes deben coincidir
      equal = crypto.timingSafeEqual(a, b); // Comparación en tiempo constante
    }
  } catch (e) {
    equal = false; // Cualquier error => sin coincidencia
  }

  if (!equal) { // No coincide
    return res.status(401).json({ message: "Invalid device API key." }); // 401
  }

  return next(); // Continuar
};

module.exports = { verifyDeviceApiKey }; // Exportar
