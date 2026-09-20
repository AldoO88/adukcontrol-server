// Router de Autenticación
// Montado en /auth (no bajo /api).
const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  signupController,
  loginController,
  logoutController,
  requestActivationController,
  verifyOtpController,
  activateAccountController,
  verifyController,
  registerStaffFcmToken,
  changePasswordController,
  requestPasswordReset,
  verifyPasswordResetOtp,
  resetPassword,
  updateMyNotificationPreferences,
} = require("../controllers/auth.controller");
const { isAuthenticated } = require("../middleware/jwt.middleware");

const { Router } = express;
const router = Router();

// Rate limiter para el endpoint de solicitud de OTP.
// Limita a 5 solicitudes por hora por IP para evitar SMS bombing.
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

// POST /auth/login — login universal: phoneNumber + password (todos los roles)
router.post("/login", loginController);

// POST /auth/logout — limpia la cookie HttpOnly
router.post("/logout", logoutController);

// POST /auth/request-activation — tutor pide OTP por WhatsApp (rate-limited)
router.post("/request-activation", otpRequestLimiter, requestActivationController);

// POST /auth/verify-otp — valida OTP sin activar la cuenta
router.post("/verify-otp", verifyOtpController);

// POST /auth/activate-account — tutor verifica OTP y establece password
router.post("/activate-account", activateAccountController);

// GET /auth/verify — decodificar JWT (requiere token)
router.get("/verify", isAuthenticated, verifyController);

// POST /auth/fcm-token — registrar token FCM para notificaciones del staff
router.post("/fcm-token", isAuthenticated, registerStaffFcmToken);

// PUT /auth/change-password — cambiar contraseña (cualquier usuario autenticado)
router.put("/change-password", isAuthenticated, changePasswordController);

// POST /auth/forgot-password/request — solicitar OTP para recuperar contraseña por WhatsApp (rate-limited)
router.post(
  "/forgot-password/request",
  otpRequestLimiter,
  requestPasswordReset
);

// POST /auth/forgot-password/verify — validar OTP de recuperación
router.post("/forgot-password/verify", verifyPasswordResetOtp);

// POST /auth/forgot-password/reset — asignar nueva contraseña usando OTP
router.post("/forgot-password/reset", resetPassword);

// PUT /auth/me/notification-preferences — activar/desactivar WhatsApp para el usuario actual
router.put("/me/notification-preferences", isAuthenticated, updateMyNotificationPreferences);

module.exports = router;
