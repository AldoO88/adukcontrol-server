const { expressjwt: jwt } = require("express-jwt"); // Fábrica de middleware JWT

const isAuthenticated = jwt({ // Construir el middleware
  secret: process.env.SECRET_KEY, // Secreto HMAC
  algorithms: ["HS256"], // Algoritmos permitidos
  requestProperty: "payload", // Adjuntar token decodificado aquí
  getToken: getTokenFromHeaders, // Función extractora
});

function getTokenFromHeaders(req) { // Extraer token Bearer
  if ( // Si la cabecera está presente y comienza con Bearer
    req.headers.authorization &&
    req.headers.authorization.split(" ")[0] === "Bearer"
  ) {
    return req.headers.authorization.split(" ")[1]; // Devolver token crudo
  }
  return null; // No hay token
}

module.exports = { // Exportar
  isAuthenticated,
};
