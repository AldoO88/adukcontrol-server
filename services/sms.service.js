// DEPRECATED: Este servicio ya no se usa para OTPs.
// Los OTPs ahora van por WhatsApp vía services/whatsapp.service.js
// (Twilio WhatsApp Business API + Authentication template).
//
// Se mantiene el archivo con un warning para no romper callers legacy
// que pudieran haber quedado en scripts de seed o en tests.
// TODO(2026-Q2): eliminar completamente cuando se confirme que no hay
// imports en ningún sitio.

const sendSms = async (phoneNumber, message) => {
  console.warn(
    "[DEPRECATED] services/sms.service.js sendSms() should not be called anymore. Use whatsappService.sendOtpViaWhatsApp() instead."
  );
  // Por seguridad, NO enviamos nada real — solo loggeamos. Si en algún
  // script de seed hay un import residual, lo verá en consola.
  console.log(`[sms][mock-noop] To: +52${phoneNumber} | Message: ${message}`);
  return { dispatched: false, provider: "noop", deprecated: true };
};

module.exports = { sendSms };
