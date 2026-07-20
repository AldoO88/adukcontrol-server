// Router de Autenticación
// Montado en /auth (no bajo /api).
const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  signupController,
  loginController,
  loginStaffController,
  loginTutorController,
  requestActivationController,
  activateAccountController,
  verifyController,
} = require("../controllers/auth.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");

const { Router } = express;
const router = Router();

// Rate limiter para el endpoint de solicitud de OTP.
// Limita a 5 solicitudes por hora por IP para evitar SMS bombing.
// En producción debería usarse un store distribuido (Redis) y limitar por
// phoneNumber en lugar de IP.
const otpRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many OTP requests. Please try again in an hour.",
  },
});

// POST /auth/signup — crear usuario (staff o tutor pre-registrado)
router.post("/signup", signupController);

// POST /auth/login — login combinado (mantener para retro-compatibilidad)
router.post("/login", loginController);

// POST /auth/login-staff — staff: email + password
router.post("/login-staff", loginStaffController);

// POST /auth/login-tutor — tutor activado: phoneNumber + password
router.post("/login-tutor", loginTutorController);

// POST /auth/request-activation — tutor pide OTP por SMS (rate-limited)
router.post("/request-activation", otpRequestLimiter, requestActivationController);

// POST /auth/activate-account — tutor verifica OTP y establece password
router.post("/activate-account", activateAccountController);

// GET /auth/verify — decodificar JWT (requiere token)
router.get("/verify", isAuthenticated, verifyController);

module.exports = router;
