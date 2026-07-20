// Servicio de SMS.
// MOCK: por ahora solo loggea a consola. En producción, reemplazar con Twilio,
// AWS SNS, MessageBird, etc.
//
// Para integrar Twilio:
//   const twilio = require("twilio")(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
//   await twilio.messages.create({ to: phoneNumber, from: ..., body: message });
//
// Para integrar AWS SNS:
//   const sns = new AWS.SNS();
//   await sns.publish({ PhoneNumber: phoneNumber, Message: message }).promise();

const sendSms = async (phoneNumber, message) => {
  // Simulación: en desarrollo, el OTP aparece en la consola del servidor
  // para que se pueda probar el flujo sin un proveedor real.
  console.log(`[sms][mock] To: +52${phoneNumber} | Message: ${message}`);
  return { dispatched: true, provider: "mock" };
};

module.exports = { sendSms };
