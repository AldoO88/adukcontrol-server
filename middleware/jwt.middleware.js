// Middleware de autenticación por JWT
// Verifica que la petición incluya un token Bearer válido en la cabecera
// "Authorization". Si es válido, decodifica el payload y lo adjunta a
// req.payload. Si no, responde 401.
const { expressjwt: jwt } = require("express-jwt"); // Middleware JWT para Express

// Construir el middleware con configuración fija
const isAuthenticated = jwt({
  secret: process.env.SECRET_KEY, // Clave HMAC usada para firmar los tokens
  algorithms: ["HS256"], // Algoritmos permitidos
  requestProperty: "payload", // Adjuntar el payload decodificado en req.payload
  getToken: getTokenFromHeaders, // Función que extrae el token de la cabecera
});

// Extrae el token de la cabecera "Authorization: Bearer <token>"
function getTokenFromHeaders(req) {
  if (
    req.headers.authorization &&
    req.headers.authorization.split(" ")[0] === "Bearer"
  ) {
    return req.headers.authorization.split(" ")[1];
  }
  return null; // No hay token
}

module.exports = {
  isAuthenticated,
};
