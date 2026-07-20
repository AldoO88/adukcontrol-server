// Middleware de autorización por roles
// Se usa después de isAuthenticated. Verifica que el role del usuario
// (req.payload.role, poblado por jwt.middleware) esté en la lista permitida.
//
// Ejemplo de uso en una ruta:
//   router.post("/", authorize("admin", "registrar"), createController);
//
// Acepta roles tanto como argumentos sueltos como en un arreglo,
// por flexibilidad al invocarlo.
const authorize = (...allowedRoles) => {
  // Aplanar por si pasan un arreglo, y descartar valores vacíos
  const roles = allowedRoles.flat().filter(Boolean);

  if (roles.length === 0) {
    // Falla de programación: authorize() sin roles permitidos
    throw new Error("authorize() requires at least one role.");
  }

  return (req, res, next) => {
    // Sin payload JWT: la ruta no usó isAuthenticated antes
    if (!req.payload) {
      return res.status(401).json({ message: "Authentication required." });
    }

    // El role del usuario no está en la lista permitida
    if (!roles.includes(req.payload.role)) {
      return res.status(403).json({
        message: `Role '${req.payload.role || "unknown"}' is not authorized to access this resource.`,
      });
    }

    return next();
  };
};

module.exports = { authorize };
