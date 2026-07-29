// scripts/reset-user-password.js
// Resetea el password de un usuario específico buscándolo por phoneNumber.
// Útil cuando:
//   - El usuario fue creado antes de que el pre-save hook funcionara
//     (password guardado en texto plano, no hasheado)
//   - El usuario olvidó su password y no hay endpoint de reset
//   - Testing: querés re-crear un usuario con password conocido
//
// Uso:
//   node scripts/reset-user-password.js <phoneNumber> <newPassword>
//
// Ejemplo:
//   node scripts/reset-user-password.js 5512345678 "NewPass123"
//
// ⚠️ Solo para uso administrativo. No usar en producción sin protección.

require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User.model");

const resetPassword = async () => {
  const phoneNumber = process.argv[2];
  const newPassword = process.argv[3];

  if (!phoneNumber || !newPassword) {
    console.error(
      "Usage: node scripts/reset-user-password.js <phoneNumber> <newPassword>"
    );
    process.exit(1);
  }

  if (newPassword.length < 8) {
    console.error("Password must be at least 8 characters long.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      console.error(`User not found: ${phoneNumber}`);
      process.exit(1);
    }

    console.log(`[reset] Found user: _id=${user._id} role=${user.role} isActive=${user.isActive}`);
    console.log(`[reset] Old password hash: ${user.password ? user.password.substring(0, 20) + "..." : "EMPTY"}`);

    // Hashear el nuevo password manualmente (bypass del flow normal)
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Usar updateOne para no disparar el pre-save hook (que duplicaría el hash)
    const result = await User.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword } }
    );

    if (result.modifiedCount === 1) {
      console.log(`[reset] Password updated successfully for ${phoneNumber}`);
      console.log(`[reset] New password hash: ${hashedPassword.substring(0, 20)}...`);
      console.log(`[reset] Try logging in with: phoneNumber=${phoneNumber} password=${newPassword}`);
    } else {
      console.error("[reset] Password was not updated (modifiedCount != 1).");
    }
  } catch (err) {
    console.error("[reset] FAILED:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

resetPassword();
