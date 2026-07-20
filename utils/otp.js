// Generador de OTP (One Time Password).
// Usa crypto.randomInt, que es criptográficamente seguro (a diferencia de Math.random).
// Devuelve una cadena de 6 dígitos con padding a la izquierda.
const crypto = require("crypto");

// Genera un OTP numérico de 6 dígitos (rango 000000..999999).
const generateOtp = () => {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
};

module.exports = { generateOtp };
