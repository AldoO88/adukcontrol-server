const express = require("express"); // Módulo Express
const { // Controladores
  signupController,
  loginController,
  verifyController,
} = require("../controllers/auth.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware"); // Middleware JWT

const { Router } = express; // Desestructurar constructor Router
const router = Router(); // Construir sub-router

router.post("/signup", signupController); // POST /auth/signup
router.post("/login", loginController); // POST /auth/login
router.get("/verify", isAuthenticated, verifyController); // GET /auth/verify (requiere JWT)

module.exports = router; // Exportar
