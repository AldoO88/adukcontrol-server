// Controlador de Autenticación
// Endpoints bajo /auth:
//   - POST /auth/signup             — crear usuario (staff o tutor pre-registrado)
//   - POST /auth/login              — login universal con phoneNumber + password
//   - POST /auth/logout             — limpia la cookie HttpOnly
//   - POST /auth/request-activation — solicitar OTP de activación (tutor)
//   - POST /auth/activate-account   — verificar OTP y establecer password (tutor)
//   - GET  /auth/verify             — decodificar JWT
//   - PUT  /auth/change-password    — cambiar contraseña (cualquier usuario autenticado)
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User.model");
const School = require("../models/School.model");
const Student = require("../models/Student.model");
const Guardian = require("../models/Guardian.model");
const whatsappService = require("../services/whatsapp.service");
const { generateOtp } = require("../utils/otp");

// Cookie options para HttpOnly. Se setea en login/signup/activate.
// En desarrollo secure:false (HTTP). En producción secure:true (HTTPS).
const COOKIE_NAME = "token";
const getCookieOptions = (expiresInMs) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: expiresInMs,
  path: "/",
});

// Setea la cookie HttpOnly con el JWT. Helper compartido por login/signup/activate.
const setAuthCookie = (res, token, expiresInMs) => {
  res.cookie(COOKIE_NAME, token, getCookieOptions(expiresInMs));
};

// Construye el objeto público del usuario que se devuelve al frontend.
const buildAuthResponse = (user) => ({
  _id: user._id,
  email: user.email,
  name: user.name,
  last_name: user.last_name,
  role: user.role,
  phoneNumber: user.phoneNumber,
  school: user.school ? (user.school._id || user.school) : null,
  isActive: user.isActive,
  sex: user.sex || null,
});

// POST /auth/signup
// Registro único y global para todos los roles. El mismo endpoint sirve
// tanto para personal de la escuela (admin, maestro, etc.) como para
// padres/tutores.
//
// Campos universales (obligatorios para todos):
//   - name
//   - phoneNumber (10 dígitos)
//   - role
//   - school (excepto super_admin, que es cross-tenant)
//   - password (excepto tutor; se establece en /activate-account vía OTP)
//
// Campos específicos para role="tutor" (obligatorios):
//   - guardian_profile: { name, relationship }
//   - student_ids: [ObjectId, ...] (≥1, deben existir y ser de la misma escuela)
//
// Campos opcionales para todos:
//   - email
//
// Efectos secundarios según rol:
//   - staff / super_admin: solo crea el User
//   - tutor: crea el User + un Guardian vinculado a esos estudiantes
//     (sincroniza Student.guardians bidireccionalmente)
const signupController = async (req, res, next) => {
  try {
    const {
      name,
      last_name,
      email,
      password,
      role,
      school,
      phoneNumber,
      guardian_profile,
      student_ids,
      sex,
      whatsapp_opt_in,
      academicPreparation,
    } = req.body;

    // === Validaciones universales ===
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "name is required." });
    }
    if (!last_name || !last_name.trim()) {
      return res.status(400).json({ message: "last_name is required." });
    } 
    if (!phoneNumber || !/^\d{10}$/.test(phoneNumber)) {
      return res
        .status(400)
        .json({ message: "phoneNumber is required and must be 10 digits." });
    }
    if (!role) {
      return res.status(400).json({ message: "role is required." });
    }
    if (role !== "super_admin" && !school) {
      return res
        .status(400)
        .json({ message: "school is required for non super_admin users." });
    }

    // password: requerido solo para super_admin y admin; otros roles se activan vía OTP
    if (role !== "super_admin" && role !== "admin" && !password) {
      // password es opcional — el usuario lo establece después vía OTP
    } else if (role !== "super_admin" && role !== "admin" && password && password.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters long." });
    } else if ((role === "super_admin" || role === "admin") && !password) {
      return res
        .status(400)
        .json({ message: "password is required for super_admin and admin." });
    } else if (password !== undefined && password.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters long." });
    }

    // email opcional; si viene, validar formato
    if (email !== undefined && email !== null && email !== "") {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(email)) {
        return res
          .status(400)
          .json({ message: "Please provide a valid email address." });
      }
    }

    // Validar escuela (si se pasó)
    if (school) {
      const schoolDoc = await School.findById(school);
      if (!schoolDoc) {
        return res.status(404).json({ message: "School not found." });
      }
      if (!schoolDoc.isActive) {
        return res
          .status(400)
          .json({ message: "Cannot assign users to an inactive school." });
      }
    }

    // === Validaciones específicas para tutor ===
    let validStudentIds = [];
    if (role === "tutor") {
      if (
        !guardian_profile ||
        !guardian_profile.name ||
        !guardian_profile.relationship
      ) {
        return res.status(400).json({
          message:
            "guardian_profile with name and relationship is required for tutor role.",
        });
      }
      if (!Array.isArray(student_ids) || student_ids.length === 0) {
        return res.status(400).json({
          message: "student_ids must be a non-empty array for tutor role.",
        });
      }
      const candidateIds = student_ids.filter((id) =>
        mongoose.Types.ObjectId.isValid(id)
      );
      if (candidateIds.length !== student_ids.length) {
        return res
          .status(400)
          .json({ message: "All student_ids must be valid ObjectIds." });
      }
      const students = await Student.find({
        _id: { $in: candidateIds },
        school,
      }).select("_id");
      if (students.length !== candidateIds.length) {
        return res.status(400).json({
          message:
            "Some student_ids do not exist or belong to a different school.",
        });
      }
      validStudentIds = students.map((s) => s._id);
    }

    // === Crear User (universal) ===
    // Si el body incluye whatsapp_opt_in=true (o truthy) grabamos el
    // consentimiento con source='signup' para auditoría. Cualquier
    // otro valor (undefined, false, null) deja opted_in=false — el
    // usuario lo activa después vía PUT /auth/me/notification-preferences.
    const notificationPrefs = {};
    if (whatsapp_opt_in === true || whatsapp_opt_in === "true") {
      notificationPrefs.whatsapp = {
        opted_in: true,
        opted_in_at: new Date(),
        source: "signup",
      };
    }

    const createdUser = await User.create({
      name: name.trim(),
      last_name: last_name ? last_name.trim() : null,
      email: email || undefined,
      ...(password ? { password } : {}),
      role,
      school: school || null,
      phoneNumber: phoneNumber.trim(),
      sex: sex || null,
      academicPreparation: academicPreparation || [],
      ...(Object.keys(notificationPrefs).length > 0 ? { notification_prefs: notificationPrefs } : {}),
    });

    // === Efecto secundario: crear Guardian si es tutor ===
    let createdGuardian = null;
    if (role === "tutor") {
      const guardianNotificationPrefs = {};
      if (whatsapp_opt_in === true || whatsapp_opt_in === "true") {
        guardianNotificationPrefs.whatsapp = {
          opted_in: true,
          opted_in_at: new Date(),
          source: "signup",
        };
      }
      createdGuardian = await Guardian.create({
        school,
        user_id: createdUser._id,
        name: guardian_profile.name,
        relationship: guardian_profile.relationship,
        phone: phoneNumber.trim(),
        students: validStudentIds,
        sex: sex || null,
        ...(Object.keys(guardianNotificationPrefs).length > 0
          ? { notification_prefs: guardianNotificationPrefs }
          : {}),
      });

      // Sincronizar el lado Student.guardians
      await Student.updateMany(
        { _id: { $in: validStudentIds } },
        { $addToSet: { guardians: createdGuardian._id } }
      );
    }

    // === Firmar JWT y responder ===
    const authToken = jwt.sign(
      {
        _id: createdUser._id,
        email: createdUser.email,
        name: createdUser.name,
        role: createdUser.role,
        schoolId: createdUser.school,
      },
      process.env.SECRET_KEY,
      { algorithm: "HS256", expiresIn: "8h" }
    );

    // Setea la cookie HttpOnly ANTES de res.json() (los headers ya se envían después)
    setAuthCookie(res, authToken, 8 * 60 * 60 * 1000);

    res.status(201).json({
      message: "User created successfully",
      user: buildAuthResponse(createdUser),
      guardian: createdGuardian, // null si no es tutor
      authToken,
    });
  } catch (error) {
    next(error);
  }
};

// POST /auth/login
// Login universal: SOLO phoneNumber + password (sin importar el rol).
const loginController = async (req, res, next) => {
  try {
    // Logging diagnóstico: ayuda a debuggear problemas donde el body
    // llega vacío (ej. falta Content-Type, FormData mal enviado, etc.)
    console.log("[login] === DEBUG ===");
    console.log("[login] Content-Type:", req.headers["content-type"]);
    console.log("[login] Raw body:", JSON.stringify(req.body));
    console.log("[login] Body keys:", Object.keys(req.body || {}));

    const { phone, phoneNumber: phoneNumberRaw, password } = req.body || {}; //
    const phoneNumber = phoneNumberRaw || phone;



    console.log("[login] Attempting login for phoneNumber:", phoneNumber);

    if (!phoneNumber || !/^\d{10}$/.test(phoneNumber)) {
      return res
        .status(400)
        .json({ message: "phoneNumber is required and must be 10 digits." });
    }
    if (!password) {
      return res.status(400).json({ message: "password is required." });
    }

    const foundUser = await User.findOne({ phoneNumber })
      .select("+password")
      .populate("school", "name cct logoUrl isActive");

    

    // Diagnóstico: ayuda a identificar si el password está hasheado,
    // si el usuario existe, si tiene password, etc.
    if (!foundUser) {
      console.log(`[login] User NOT found for phoneNumber: ${phoneNumber}`);
    } else {
      console.log(`[login] User found: _id=${foundUser._id} role=${foundUser.role} isActive=${foundUser.isActive}`);
      console.log(`[login] Password field: ${foundUser.password ? "set (" + foundUser.password.length + " chars)" : "EMPTY/NULL"}`);
      console.log(`[login] Password looks like bcrypt hash: ${foundUser.password && foundUser.password.startsWith("$2") ? "YES" : "NO (raw text?)"}`);
    }

    const isPasswordCorrect = foundUser
      ? await foundUser.comparePassword(password)
      : false;
    console.log(`[login] Password match result: ${isPasswordCorrect}`);

    if (!isPasswordCorrect) {
      return res.status(401).json({ message: "Invalid Password" });
    }

   

    if (
      foundUser.role !== "super_admin" &&
      foundUser.school &&
      foundUser.school.isActive === false
    ) {
      return res
        .status(403)
        .json({ message: "Your school is inactive. Contact support." });
    }

    const authToken = jwt.sign(
      {
        _id: foundUser._id,
        email: foundUser.email,
        name: foundUser.name,
        role: foundUser.role,
        schoolId: foundUser.school ? foundUser.school._id : null,
      },
      process.env.SECRET_KEY,
      { algorithm: "HS256", expiresIn: "30m" }
    );

    // Setea la cookie HttpOnly ANTES de res.json()
    setAuthCookie(res, authToken, 30 * 60 * 1000);

    res.status(200).json({
      user: buildAuthResponse(foundUser),
      authToken,
    });
  } catch (error) {
    next(error);
  }
};

// POST /auth/logout
// Limpia la cookie HttpOnly. Stateless: no invalida el JWT en el server
// (el cliente debe además descartar el token que tenga en memoria).
const logoutController = (req, res) => {
  res.clearCookie(COOKIE_NAME, getCookieOptions(0));
  res.status(200).json({ message: "Logged out." });
};

// POST /auth/request-activation
// El tutor (pre-registrado por la escuela) solicita un OTP por WhatsApp.
const requestActivationController = async (req, res, next) => {
  try {
    const { phoneNumber: phoneNumberRaw, phone } = req.body || {};
    const phoneNumber = phoneNumberRaw || phone;

    if (!phoneNumber || !/^\d{10}$/.test(phoneNumber)) {
      return res
        .status(400)
        .json({ message: "phoneNumber is required and must be 10 digits." });
    }

    const user = await User.findOne({ phoneNumber }).select(
      "+otpCode +otpExpiresAt"
    );

    if (!user) {
      return res
        .status(404)
        .json({ message: "Phone number not registered by the school." });
    }
    if (user.role !== "tutor") {
      return res
        .status(400)
        .json({ message: "Activation flow is only for tutor accounts." });
    }
    if (user.isActive) {
      return res
        .status(400)
        .json({ message: "Account is already active. Please log in." });
    }

    // Opt-in check: el tutor debe tener consentimiento explícito para
    // recibir WhatsApp. La escuela lo captura al pre-registrarlo, o el
    // tutor lo activa después vía PUT /auth/me/notification-preferences.
    if (!user.notification_prefs?.whatsapp?.opted_in) {
      return res.status(451).json({
        message:
          "We need your consent to send you WhatsApp messages. Please ask your school to enable WhatsApp notifications for your account.",
        consent_required: true,
      });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user.otpCode = otp;
    user.otpExpiresAt = expiresAt;
    await user.save();

    // Enviar OTP por WhatsApp (Twilio Authentication template).
    await whatsappService.sendOtpViaWhatsApp(phoneNumber, otp, "activation");

    res.status(200).json({
      message: "Activation code sent to your phone.",
      expiresAt,
    });
  } catch (error) {
    // Errores de Twilio: mapear a HTTP status apropiado.
    if (error instanceof whatsappService.ConsentRequiredError) {
      return res.status(451).json({
        message:
          "Recipient has not opted in to WhatsApp messages from EdukControl.",
        consent_required: true,
      });
    }
    if (error instanceof whatsappService.TemplateNotApprovedError) {
      console.error(
        "[requestActivationController] WhatsApp template not approved. Check TWILIO_OTP_TEMPLATE_ID in .env."
      );
      return res.status(503).json({
        message:
          "OTP service temporarily unavailable. Please contact your school.",
      });
    }
    if (error instanceof whatsappService.InvalidPhoneError) {
      return res.status(400).json({
        message:
          "The registered phone number is not valid for WhatsApp delivery.",
      });
    }
    next(error);
  }
};

// POST /auth/verify-otp
// Verifica que el OTP sea correcto y no haya expirado, SIN activar la
// cuenta ni cambiar el password. Usado por el front para validar el
// código antes de pedirle al usuario que establezca su password.
// Body: { phoneNumber, otpCode }
// 200 si el OTP es válido (la cuenta sigue inactiva, el OTP se mantiene)
// 400 si es inválido o expirado
const verifyOtpController = async (req, res, next) => {
  try {
    const { phoneNumber: phoneNumberRaw, phone, otpCode } = req.body || {};
    const phoneNumber = phoneNumberRaw || phone;

    console.log("[verify-otp] Attempting OTP verification for phoneNumber:", phoneNumber);

    if (!phoneNumber || !otpCode) {
      return res
        .status(400)
        .json({ message: "phoneNumber and otpCode are required." });
    }
    if (!/^\d{10}$/.test(phoneNumber)) {
      return res.status(400).json({ message: "phoneNumber must be 10 digits." });
    }
    if (!/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({ message: "otpCode must be 6 digits." });
    }

    const user = await User.findOne({ phoneNumber })
      .select("+otpCode +otpExpiresAt +password")
      .select("+isActive");

    if (!user) {
      return res.status(404).json({ message: "Phone number not registered." });
    }
    if (user.isActive) {
      return res
        .status(400)
        .json({ message: "Account is already active. Please log in." });
    }
    if (!user.otpCode || !user.otpExpiresAt) {
      return res.status(400).json({
        message: "No pending activation. Please request a new code.",
      });
    }
    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({
        message: "Activation code has expired. Please request a new one.",
      });
    }

    const otpMatches = await user.compareOtp(otpCode);
    if (!otpMatches) {
      return res.status(400).json({ message: "Invalid activation code." });
    }

    // OTP válido — la cuenta sigue inactiva y el OTP se mantiene
    // (lo va a usar /activate-account para completar el flujo)
    res.status(200).json({
      message: "Activation code verified.",
      phoneNumber,
    });
  } catch (error) {
    next(error);
  }
};

// POST /auth/activate-account
// El tutor verifica el OTP y establece su contraseña permanente.
const activateAccountController = async (req, res, next) => {
  try {
    const { phoneNumber: phoneNumberRaw, phone, otpCode, newPassword } =
      req.body || {};
    const phoneNumber = phoneNumberRaw || phone;

    if (!phoneNumber || !otpCode || !newPassword) {
      return res.status(400).json({
        message: "phoneNumber, otpCode, and newPassword are required.",
      });
    }
    if (!/^\d{10}$/.test(phoneNumber)) {
      return res
        .status(400)
        .json({ message: "phoneNumber must be 10 digits." });
    }
    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters long." });
    }
    if (!/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({ message: "otpCode must be 6 digits." });
    }

    const user = await User.findOne({ phoneNumber })
      .select("+otpCode +otpExpiresAt +password")
      .populate("school", "name cct logoUrl isActive");

    if (!user) {
      return res.status(404).json({ message: "Phone number not registered." });
    }
    if (user.isActive) {
      return res
        .status(400)
        .json({ message: "Account is already active. Please log in." });
    }
    if (!user.otpCode || !user.otpExpiresAt) {
      return res.status(400).json({
        message: "No pending activation. Please request a new code.",
      });
    }
    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({
        message: "Activation code has expired. Please request a new one.",
      });
    }

    const otpMatches = await user.compareOtp(otpCode);
    if (!otpMatches) {
      return res.status(400).json({ message: "Invalid activation code." });
    }

    user.password = newPassword;
    user.otpCode = null;
    user.otpExpiresAt = null;
    user.isActive = true;
    await user.save();

    const authToken = jwt.sign(
      {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        schoolId: user.school ? user.school._id : null,
      },
      process.env.SECRET_KEY,
      { algorithm: "HS256", expiresIn: "30m" }
    );

    // Setea la cookie HttpOnly ANTES de res.json()
    setAuthCookie(res, authToken, 30 * 60 * 1000);

    res.status(200).json({
      message: "Account activated successfully.",
      user: buildAuthResponse(user),
      authToken,
    });
  } catch (error) {
    next(error);
  }
};

// GET /auth/verify
const verifyController = (req, res, next) => {
  try {
    res.status(200).json({ user: req.payload });
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// PUT /auth/me/notification-preferences
// Body: { whatsapp_opted_in: boolean }
// Permite al usuario activar/desactivar WhatsApp para sí mismo (self-service).
// Cualquier rol puede llamarlo: tutor, teacher, admin, etc.
//
// Si el usuario es tutor, sincronizamos también el campo en su registro
// Guardian (la fuente de verdad histórica para tutores).
// =====================================================================
const updateMyNotificationPreferences = async (req, res, next) => {
  try {
    const { whatsapp_opted_in } = req.body || {};
    if (typeof whatsapp_opted_in !== "boolean") {
      return res.status(400).json({
        message: "whatsapp_opted_in must be a boolean.",
      });
    }

    const user = await User.findById(req.payload._id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const source =
      user.notification_prefs?.whatsapp?.opted_in === whatsapp_opted_in
        ? user.notification_prefs?.whatsapp?.source || "self_profile"
        : "self_profile";

    user.notification_prefs = {
      ...(user.notification_prefs?.toObject?.() || user.notification_prefs || {}),
      whatsapp: {
        opted_in: whatsapp_opted_in,
        opted_in_at: whatsapp_opted_in ? new Date() : null,
        source,
      },
    };
    await user.save();

    // Sincronizar con Guardian si el usuario es tutor (best-effort).
    if (user.role === "tutor") {
      try {
        await Guardian.updateMany(
          { user_id: user._id },
          {
            $set: {
              "notification_prefs.whatsapp.opted_in": whatsapp_opted_in,
              "notification_prefs.whatsapp.opted_in_at": whatsapp_opted_in
                ? new Date()
                : null,
              "notification_prefs.whatsapp.source": source,
            },
          }
        );
      } catch (syncErr) {
        console.warn(
          "[updateMyNotificationPreferences] Failed to sync Guardian:",
          syncErr.message
        );
      }
    }

    res.status(200).json({
      message: "Notification preferences updated.",
      notification_prefs: user.notification_prefs,
    });
  } catch (error) {
    next(error);
  }
};

// POST /auth/fcm-token
// Register/update FCM token for staff users (teachers, admin, etc.)
// Allows staff to receive push notifications (e.g., when guardian confirms
// or requests reschedule of a citation).
const registerStaffFcmToken = async (req, res, next) => {
  try {
    const { fcm_token } = req.body;

    if (!fcm_token || !String(fcm_token).trim()) {
      return res.status(400).json({ message: "fcm_token is required." });
    }

    const user = await User.findById(req.payload._id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    user.fcm_token = String(fcm_token).trim();
    await user.save();

    res.status(200).json({ message: "FCM token registered successfully." });
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// PUT /auth/change-password
// Cambia la contraseña del usuario autenticado.
// Body: { currentPassword, newPassword }
// =====================================================================
const changePasswordController = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // 1. Validar campos requeridos.
    if (!currentPassword || !String(currentPassword).trim()) {
      return res.status(400).json({ message: "La contraseña actual es obligatoria." });
    }
    if (!newPassword || !String(newPassword).trim()) {
      return res.status(400).json({ message: "La nueva contraseña es obligatoria." });
    }

    // 2. Validar longitud mínima.
    if (String(newPassword).length < 8) {
      return res.status(400).json({ message: "La nueva contraseña debe tener al menos 8 caracteres." });
    }

    // 3. Validar que la nueva sea diferente a la actual.
    if (currentPassword === newPassword) {
      return res.status(400).json({ message: "La nueva contraseña debe ser diferente a la actual." });
    }

    // 4. Buscar el usuario con password (select: false por defecto).
    const user = await User.findById(req.payload._id).select("+password");
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    // 5. Verificar la contraseña actual.
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ message: "La contraseña actual es incorrecta." });
    }

    // 6. Asignar nueva contraseña y guardar (bcrypt hashea en pre-save hook).
    user.password = newPassword;
    await user.save();

    res.status(200).json({ message: "Contraseña actualizada correctamente." });
  } catch (error) {
    next(error);
  }
};

// =====================================================================
// RECUPERACIÓN DE CONTRASEÑA (forgot-password)
// ---------------------------------------------------------------------
// Flujo de 3 endpoints análogo al de activación, pero para usuarios
// que YA tienen cuenta activa y olvidaron su contraseña. Aplica a
// cualquier rol (tutor, teacher, prefect, social_worker, principal,
// admin, registrar, super_admin).
//
//   1. requestPasswordReset       → genera OTP, envía SMS.
//   2. verifyPasswordResetOtp     → valida el OTP sin cambiar nada.
//   3. resetPassword              → valida OTP + asigna nueva contraseña.
// =====================================================================

// POST /auth/forgot-password/request
// Body: { phone: string }
// Genera un OTP, lo hashea, lo guarda con expiración de 10 minutos,
// y envía un WhatsApp con el código vía Twilio Authentication template.
// NO devuelve el código al cliente (solo confirmación de envío).
//
// Aplica a cualquier rol (tutor, teacher, admin, etc.) que tenga
// opted_in a WhatsApp. Si opted_in=false, retorna 451 para que el
// front pida al usuario activar el canal desde su perfil.
const requestPasswordReset = async (req, res, next) => {
  try {
    const { phoneNumber: phoneNumberRaw, phone } = req.body || {};
    const phoneNumber = phoneNumberRaw || phone;

    if (!phoneNumber || !/^\d{10}$/.test(phoneNumber)) {
      return res.status(400).json({
        message: "phoneNumber is required and must be 10 digits.",
      });
    }

    const user = await User.findOne({ phoneNumber }).select(
      "+otpCode +otpExpiresAt"
    );

    if (!user) {
      return res.status(404).json({
        message: "Phone number not registered.",
      });
    }

    // Opt-in check (mismo gate que activación, pero para todos los roles).
    if (!user.notification_prefs?.whatsapp?.opted_in) {
      return res.status(451).json({
        message:
          "We need your consent to send you WhatsApp messages. Please enable WhatsApp notifications in your profile.",
        consent_required: true,
      });
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user.otpCode = otp;
    user.otpExpiresAt = expiresAt;
    await user.save();

    // Enviar OTP por WhatsApp (Twilio Authentication template).
    await whatsappService.sendOtpViaWhatsApp(
      phoneNumber,
      otp,
      "password_reset"
    );

    res.status(200).json({
      message: "Password reset code sent to your phone.",
      expiresAt,
    });
  } catch (error) {
    if (error instanceof whatsappService.ConsentRequiredError) {
      return res.status(451).json({
        message:
          "Recipient has not opted in to WhatsApp messages from EdukControl.",
        consent_required: true,
      });
    }
    if (error instanceof whatsappService.TemplateNotApprovedError) {
      console.error(
        "[requestPasswordReset] WhatsApp template not approved. Check TWILIO_OTP_TEMPLATE_ID in .env."
      );
      return res.status(503).json({
        message:
          "OTP service temporarily unavailable. Please try again later.",
      });
    }
    if (error instanceof whatsappService.InvalidPhoneError) {
      return res.status(400).json({
        message:
          "The registered phone number is not valid for WhatsApp delivery.",
      });
    }
    next(error);
  }
};

// POST /auth/forgot-password/verify
// Body: { phone: string, otpCode: string }
// Valida que el OTP sea correcto y no haya expirado. NO modifica el
// password ni limpia el OTP (lo hace resetPassword al final).
const verifyPasswordResetOtp = async (req, res, next) => {
  try {
    const { phoneNumber: phoneNumberRaw, phone, otpCode } = req.body || {};
    const phoneNumber = phoneNumberRaw || phone;

    if (!phoneNumber || !otpCode) {
      return res
        .status(400)
        .json({ message: "phoneNumber and otpCode are required." });
    }
    if (!/^\d{10}$/.test(phoneNumber)) {
      return res
        .status(400)
        .json({ message: "phoneNumber must be 10 digits." });
    }
    if (!/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({ message: "otpCode must be 6 digits." });
    }

    const user = await User.findOne({ phoneNumber }).select(
      "+otpCode +otpExpiresAt"
    );

    if (!user) {
      return res.status(404).json({ message: "Phone number not registered." });
    }
    if (!user.otpCode || !user.otpExpiresAt) {
      return res.status(400).json({
        message: "No pending password reset. Please request a new code.",
      });
    }
    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({
        message: "Reset code has expired. Please request a new one.",
      });
    }

    const isMatch = await user.compareOtp(otpCode);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid reset code." });
    }

    res.status(200).json({ message: "Reset code verified." });
  } catch (error) {
    next(error);
  }
};

// POST /auth/forgot-password/reset
// Body: { phone: string, otpCode: string, newPassword: string }
// Re-valida el OTP (defense-in-depth), valida longitud mínima de
// password, asigna la nueva contraseña, limpia otpCode y otpExpiresAt.
// NO devuelve JWT — el usuario hace login manual con su nueva contraseña.
const resetPassword = async (req, res, next) => {
  try {
    const {
      phoneNumber: phoneNumberRaw,
      phone,
      otpCode,
      newPassword,
    } = req.body || {};
    const phoneNumber = phoneNumberRaw || phone;

    if (!phoneNumber || !otpCode || !newPassword) {
      return res.status(400).json({
        message: "phoneNumber, otpCode, and newPassword are required.",
      });
    }
    if (!/^\d{10}$/.test(phoneNumber)) {
      return res
        .status(400)
        .json({ message: "phoneNumber must be 10 digits." });
    }
    if (!/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({ message: "otpCode must be 6 digits." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long.",
      });
    }

    const user = await User.findOne({ phoneNumber }).select(
      "+otpCode +otpExpiresAt"
    );

    if (!user) {
      return res.status(404).json({ message: "Phone number not registered." });
    }
    if (!user.otpCode || !user.otpExpiresAt) {
      return res.status(400).json({
        message: "No pending password reset. Please request a new code.",
      });
    }
    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({
        message: "Reset code has expired. Please request a new one.",
      });
    }

    const isMatch = await user.compareOtp(otpCode);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid reset code." });
    }

    user.password = newPassword;
    user.otpCode = undefined;
    user.otpExpiresAt = undefined;
    await user.save();

    res.status(200).json({ message: "Password reset successfully." });
  } catch (error) {
    next(error);
  }
};

module.exports = {
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
};
