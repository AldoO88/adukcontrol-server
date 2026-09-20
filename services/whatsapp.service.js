// Servicio de WhatsApp Business API vía Twilio.
// Reemplaza al mock sms.service.js para OTPs de activación y recuperación
// de contraseña. Se usa Twilio porque Expo / EAS ya está configurado
// para consumir sus webhooks y simplifica el cambio cuando migremos
// push notifications de Expo.
//
// Plantilla de Authentication:
//   "Tu código de EdukControl es: {{1}}. Expira en 10 minutos."
// El Content Template SID (TWILIO_OTP_TEMPLATE_ID) debe estar aprobado
// por Meta antes del primer envío real.
//
// Errores Twilio manejados:
//   21211  - Invalid 'To' phone number
//   63007  - Recipient not opted in
//   63016  - Template not approved
//   63033  - Template paused
//   63038  - WhatsApp session not found (sandbox sin opt-in)

const twilio = require("twilio");

// Inicialización lazy para no romper el arranque del server si las
// credenciales no están configuradas todavía (ej. dev sin Twilio).
let twilioClient = null;

const getClient = () => {
  if (twilioClient) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error(
      "Twilio credentials missing. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env"
    );
  }
  twilioClient = twilio(sid, token);
  return twilioClient;
};

// Custom errors para que el caller pueda mapear a HTTP status codes sin
// acoplar a los códigos numéricos de Twilio.
class TwilioError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TwilioError";
    this.code = code;
  }
}

class ConsentRequiredError extends TwilioError {
  constructor(message = "Recipient has not opted in to WhatsApp messages.") {
    super("CONSENT_REQUIRED", message);
    this.name = "ConsentRequiredError";
  }
}

class TemplateNotApprovedError extends TwilioError {
  constructor(message = "WhatsApp template not approved by Meta yet.") {
    super("TEMPLATE_NOT_APPROVED", message);
    this.name = "TemplateNotApprovedError";
  }
}

class InvalidPhoneError extends TwilioError {
  constructor(message = "Invalid phone number for WhatsApp delivery.") {
    super("INVALID_PHONE", message);
    this.name = "InvalidPhoneError";
  }
}

// Mapea errores de Twilio a nuestros errores semánticos.
// Twilio lanza RestException con .code (número) y .message.
// Ver https://www.twilio.com/docs/errors/reference
const mapTwilioError = (err) => {
  const code = err?.code;
  const msg = err?.message || "Twilio error";

  if (code === 21211) return new InvalidPhoneError(msg);
  if (code === 63007 || code === 63038) {
    return new ConsentRequiredError(
      "Recipient has not opted in to WhatsApp messages from EdukControl."
    );
  }
  if (code === 63016 || code === 63033) {
    return new TemplateNotApprovedError(msg);
  }
  return new TwilioError(code, msg);
};

// Formatea un phoneNumber de 10 dígitos MX a E.164 (+52XXXXXXXXXX).
const toE164MX = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith("521")) return `+${digits}`;
  // Cualquier otro formato: lo dejamos que Twilio lo rechace con 21211.
  return `+${digits}`;
};

// sendOtpViaWhatsApp(phone, code, purpose)
// phone: 10 dígitos MX (o ya formateado a E.164)
// code:  6 dígitos (string)
// purpose: 'activation' | 'password_reset' (metadata, no afecta el template hoy)
//
// Returns { success: true, messageSid, status } en éxito.
// Throws TwilioError (o subclase) en error.
const sendOtpViaWhatsApp = async (phone, code, purpose = "activation") => {
  const to = toE164MX(phone);
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const contentSid = process.env.TWILIO_OTP_TEMPLATE_ID;
  const statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL;

  if (!from) {
    throw new Error(
      "TWILIO_WHATSAPP_FROM missing in .env (format: +14155238886 in sandbox)."
    );
  }
  if (!contentSid) {
    throw new TemplateNotApprovedError(
      "TWILIO_OTP_TEMPLATE_ID missing in .env. Submit and get the Authentication template approved in Twilio Console first."
    );
  }

  try {
    const client = getClient();
    const message = await client.messages.create({
      from: `whatsapp:${from}`,
      to: `whatsapp:${to}`,
      contentSid,
      // El template Authentication espera el código en la posición 1.
      contentVariables: JSON.stringify({ "1": code }),
      ...(statusCallback ? { statusCallback } : {}),
    });

    console.log(
      `[whatsapp] OTP sent purpose=${purpose} to=${to} sid=${message.sid} status=${message.status}`
    );

    return {
      success: true,
      messageSid: message.sid,
      status: message.status,
    };
  } catch (err) {
    console.error(
      `[whatsapp] sendOtpViaWhatsApp failed purpose=${purpose} to=${to} code=${err?.code} message=${err?.message}`
    );
    throw mapTwilioError(err);
  }
};

module.exports = {
  sendOtpViaWhatsApp,
  toE164MX,
  // Errors (para que el caller pueda hacer instanceof checks)
  TwilioError,
  ConsentRequiredError,
  TemplateNotApprovedError,
  InvalidPhoneError,
};
