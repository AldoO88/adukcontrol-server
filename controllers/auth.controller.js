// Controlador de Autenticación
// Endpoints bajo /auth:
//   - POST /auth/signup             — crear usuario (staff o tutor pre-registrado)
//   - POST /auth/login              — login combinado (email+password o phone+password)
//   - POST /auth/login-staff        — login de staff (email + password)
//   - POST /auth/login-tutor        — login de tutor activado (phoneNumber + password)
//   - POST /auth/request-activation — solicitar OTP de activación (tutor)
//   - POST /auth/activate-account   — verificar OTP y establecer password (tutor)
//   - GET  /auth/verify             — decodificar JWT
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User.model");
const School = require("../models/School.model");
const Student = require("../models/Student.model");
const smsService = require("../services/sms.service");
const { generateOtp } = require("../utils/otp");

// Construye el objeto público del usuario que se devuelve al frontend.
const buildAuthResponse = (user) => ({
  _id: user._id,
  email: user.email,
  name: user.name,
  role: user.role,
  phoneNumber: user.phoneNumber,
  school: user.school ? (user.school._id || user.school) : null,
  isActive: user.isActive,
  tutor_of_students: user.tutor_of_students || [],
});

// POST /auth/signup
// - Staff: requiere name, email, password, role, school.
// - Tutor: requiere name, phoneNumber, school; email y password opcionales.
//   Acepta opcionalmente tutor_of_students: [studentId, ...].
const signupController = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      role,
      school,
      phoneNumber,
      tutor_of_students,
    } = req.body;

    if (role === "tutor") {
      if (!phoneNumber || !/^\d{10}$/.test(phoneNumber)) {
        return res
          .status(400)
          .json({ message: "phoneNumber is required for tutor (10 digits)." });
      }
    } else if (!email) {
      return res
        .status(400)
        .json({ message: "email is required for non-tutor users." });
    }

    if (role !== "super_admin" && !school) {
      return res
        .status(400)
        .json({ message: "school is required for non super_admin users." });
    }

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

    // Validar tutor_of_students: todos los IDs deben existir y pertenecer a la escuela
    let tutorOfStudents = [];
    if (role === "tutor" && Array.isArray(tutor_of_students) && tutor_of_students.length > 0) {
      const validIds = tutor_of_students.filter((id) =>
        mongoose.Types.ObjectId.isValid(id)
      );
      const students = await Student.find({
        _id: { $in: validIds },
        school,
      }).select("_id");
      if (students.length !== validIds.length) {
        return res.status(400).json({
          message:
            "Some tutor_of_students are invalid or belong to a different school.",
        });
      }
      tutorOfStudents = students.map((s) => s._id);
    }

    const createdUser = await User.create({
      name,
      email,
      password,
      role,
      school,
      phoneNumber,
      tutor_of_students: tutorOfStudents,
    });

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

    res.status(201).json({
      message: "User created successfully",
      user: buildAuthResponse(createdUser),
      authToken,
    });
  } catch (error) {
    next(error);
  }
};

// Lógica común de autenticación: dado un user ya cargado, validar password,
// generar JWT y responder. Centraliza el flujo para login/login-staff/login-tutor.
const authenticateAndRespond = async (foundUser, res) => {
  if (!foundUser) {
    return res.status(404).json({ message: "Credentials not registered." });
  }
  if (!foundUser.isActive) {
    return res.status(401).json({
      message:
        "This account is not active yet. Please complete the activation process.",
    });
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

  return res.status(200).json({
    user: buildAuthResponse(foundUser),
    authToken,
  });
};

// POST /auth/login (combinado, retro-compatibilidad)
// Acepta { email, password } (staff) o { phoneNumber, password } (tutor activado).
const loginController = async (req, res, next) => {
  try {
    const { email, phoneNumber, password } = req.body;

    if (!password) {
      return res.status(400).json({ message: "password is required." });
    }

    let query;
    if (phoneNumber) {
      query = { phoneNumber };
    } else if (email) {
      query = { email };
    } else {
      return res
        .status(400)
        .json({ message: "email or phoneNumber is required." });
    }

    const foundUser = await User.findOne(query)
      .select("+password")
      .populate("school", "name cct logo isActive");

    const isPasswordCorrect = foundUser
      ? await foundUser.comparePassword(password)
      : false;
    if (!isPasswordCorrect) {
      return res.status(401).json({ message: "Incorrect credentials." });
    }

    return authenticateAndRespond(foundUser, res);
  } catch (error) {
    next(error);
  }
};

// POST /auth/login-staff
// Login tipado para staff: solo email + password.
const loginStaffController = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ message: "email is required." });
    }
    if (!password) {
      return res.status(400).json({ message: "password is required." });
    }

    const foundUser = await User.findOne({ email })
      .select("+password")
      .populate("school", "name cct logo isActive");

    const isPasswordCorrect = foundUser
      ? await foundUser.comparePassword(password)
      : false;
    if (!isPasswordCorrect) {
      return res.status(401).json({ message: "Incorrect credentials." });
    }

    return authenticateAndRespond(foundUser, res);
  } catch (error) {
    next(error);
  }
};

// POST /auth/login-tutor
// Login tipado para tutor: solo phoneNumber + password.
const loginTutorController = async (req, res, next) => {
  try {
    const { phoneNumber, password } = req.body;

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
      .populate("school", "name cct logo isActive");

    const isPasswordCorrect = foundUser
      ? await foundUser.comparePassword(password)
      : false;
    if (!isPasswordCorrect) {
      return res.status(401).json({ message: "Incorrect credentials." });
    }

    return authenticateAndRespond(foundUser, res);
  } catch (error) {
    next(error);
  }
};

// POST /auth/request-activation
// El tutor (pre-registrado por la escuela) solicita un OTP por SMS.
const requestActivationController = async (req, res, next) => {
  try {
    const { phoneNumber } = req.body;

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

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user.otpCode = otp;
    user.otpExpiresAt = expiresAt;
    await user.save(); // pre-save hook hashea otpCode

    await smsService.sendSms(
      phoneNumber,
      `Your EdukControl activation code is: ${otp}. It expires in 10 minutes.`
    );

    res.status(200).json({
      message: "Activation code sent to your phone.",
      expiresAt,
    });
  } catch (error) {
    next(error);
  }
};

// POST /auth/activate-account
// El tutor verifica el OTP y establece su contraseña permanente.
const activateAccountController = async (req, res, next) => {
  try {
    const { phoneNumber, otpCode, newPassword } = req.body;

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
      .populate("school", "name cct logo isActive");

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

module.exports = {
  signupController,
  loginController,
  loginStaffController,
  loginTutorController,
  requestActivationController,
  activateAccountController,
  verifyController,
};
