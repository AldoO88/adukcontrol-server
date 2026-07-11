const authorize = (...allowedRoles) => { // Fábrica de middleware de roles
  const roles = allowedRoles.flat().filter(Boolean); // Normalizar la lista

  if (roles.length === 0) { // Verificación de uso
    throw new Error("authorize() requires at least one role."); // Uso incorrecto
  }

  return (req, res, next) => { // Middleware devuelto
    if (!req.payload) { // Sin contexto de autenticación
      return res.status(401).json({ message: "Authentication required." }); // 401
    }

    if (!roles.includes(req.payload.role)) { // Rol no permitido
      return res.status(403).json({ // 403
        message: `Role '${req.payload.role || "unknown"}' is not authorized to access this resource.`,
      });
    }

    return next(); // Continuar al siguiente middleware
  };
};

module.exports = { authorize }; // Exportar
