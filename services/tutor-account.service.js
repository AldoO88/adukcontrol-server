// Garantiza que cada Guardian con teléfono válido tenga un User tutor
// vinculado (`User.role === "tutor"`), para que el papá pueda activar
// su cuenta desde el login móvil via `/auth/request-activation`.
//
// Contexto de negocio:
//   - El alta de un alumno (manual o importando Excel) crea un
//     `Guardian` con `user_id: null`. Antes de este helper, ese tutor
//     recibía 404 al intentar activar su cuenta.
//   - El teléfono es el identificador universal de login; el índice
//     único `{school, phoneNumber}` impide dos Users en la misma
//     escuela con el mismo celular.
//
// Esta función es idempotente y se llama desde:
//   - `POST /api/guardians` (alta manual de alumno)
//   - `POST /api/students/import` (importación Excel)
//   - eventualmente también al editar un tutor.
const User = require("../models/User.model");

// Por qué el opt-in viene forzado a `true` aquí:
//   - El flujo `/auth/request-activation` exige `opted_in === true`
//     (devuelve 451 si no). Si no activamos al crear, el papá nunca
//     podrá sacar su contraseña desde la app.
//   - El usuario eligió explícitamente NO capturar consentimiento
//     en el form de alumno ni en el Excel (decisión de UX, registrada
//     en la conversación del feature). El webhook de STOP de Twilio
//     sigue siendo la vía de baja forzada.
const TUTOR_DEFAULT_OPTED_IN = true;
const TUTOR_DEFAULT_SOURCE = "admin_form";

const ensureTutorUser = async ({ school, name, lastname, phone }) => {
  if (!phone || !school || !name) {
    return {
      ok: false,
      reason: "missing_args",
      message: "school, name y phone son requeridos",
    };
  }

  // Buscamos por escuela + teléfono. El índice único garantiza que
  // existe a lo sumo un User con esa combinación.
  let user = await User.findOne({ school, phoneNumber: phone });

  if (user) {
    // Caso 1: el User ya existe y ya es tutor → reutilizamos.
    if (user.role === "tutor") {
      // Si la última captura del nombre dejó los apellidos vacíos y
      // ahora los tenemos, sincronizamos para que el dashboard del
      // tutor pueda saludar "Hola, <name> <last_name>".
      if (
        (!user.last_name || !user.last_name.trim()) &&
        lastname &&
        lastname.trim()
      ) {
        user.last_name = lastname.trim();
        await user.save();
      }
      return { ok: true, user, reused: true };
    }
    // Caso 2: el celular ya está registrado con otro perfil
    // (teacher/admin/registrar/prefect/etc). Como el modelo tiene
    // índice único `{school, phoneNumber}`, no podemos crear un
    // segundo User. Devolvemos "phone_taken" para que el caller
    // avise al administrador; el Guardian igual se crea.
    return {
      ok: false,
      reason: "phone_taken",
      message: "Teléfono ya registrado",
    };
  }

  // Caso 3: no hay User → crear uno nuevo con el rol "tutor". El
  // pre-save hook de mongoose hashea el password si pasara; aquí va
  // null porque todavía no se activa.
  //
  // `last_name` es requerido en User para roles distintos a
  // super_admin (User.model.js:32-39). Si no nos pasaron apellido
  // (formato "Juan" sin apellido, Excel de una sola palabra) usamos
  // el mismo `name` para que el required no rechace la inserción.
  const lastNameForUser =
    lastname && lastname.trim() ? lastname.trim() : name.trim();

  user = await User.create({
    name: name.trim(),
    last_name: lastNameForUser,
    role: "tutor",
    school,
    phoneNumber: phone,
    isActive: false,
    notification_prefs: {
      whatsapp: {
        opted_in: TUTOR_DEFAULT_OPTED_IN,
        opted_in_at: new Date(),
        source: TUTOR_DEFAULT_SOURCE,
      },
    },
  });

  return { ok: true, user, reused: false };
};

module.exports = {
  ensureTutorUser,
};
