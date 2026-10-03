// Helper para reintentar `save()` de un Student cuando un controlNumber
// choca por carrera con otro `save()` concurrente.
//
// El pre-save de Student.model.js usa el patrón "find max + 1": cuando
// varios `save()` corren en paralelo (caso típico: bulk assign de grupo
// vía UI, que dispara N Promise.all a PUT /api/enrollments/:id) varios
// leen el mismo máximo y calculan el mismo siguiente controlNumber. El
// índice único `{ school, controlNumber }` rechaza al perdedor con
// E11000; este helper captura ese caso, limpia los valores auto-asignados
// en el intento fallido para forzar al pre-save a releer el máximo en
// el siguiente intento, y reescribe hasta `maxRetries`.
//
// Solo se aplica en paths concurrentes (`syncStudentCurrentGroup`,
// `updateStudent` defensivo). El import es secuencial y no lo necesita.
//
// Parámetros:
//   studentDoc   — instancia de mongoose.Document ya cargada con
//                  `school` + `current_group_id` listos para que el
//                  pre-save genere el controlNumber. El doc se muta
//                  in-place si reintentamos.
//   opts.maxRetries — número máximo de intentos (default 5).
//
// Devuelve: nada (`void`). Lanza el último error si se agotaron los
// reintentos.

const DEFAULT_MAX_RETRIES = 5;

const saveWithControlNumberRetry = async (
  studentDoc,
  { maxRetries = DEFAULT_MAX_RETRIES } = {}
) => {
  if (!studentDoc) throw new Error("saveWithControlNumberRetry: studentDoc is required");

  const bioWasEmpty = !studentDoc.biometricId;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await studentDoc.save();
      return;
    } catch (err) {
      // Reintentar solo E11000 (controlNumber o biometricId duplicados).
      if (err && err.code === 11000 && attempt < maxRetries) {
        // Limpiar lo que el pre-save calculó en este intento para que el
        // hook vuelva a computarlo contra el máximo actualizado en la
        // siguiente vuelta.
        studentDoc.controlNumber = null;
        if (bioWasEmpty) studentDoc.biometricId = null;
        // Marcar los paths como modificados para que mongoose los
        // incluya en el próximo `save()`.
        studentDoc.markModified("controlNumber");
        if (bioWasEmpty) studentDoc.markModified("biometricId");
        continue;
      }
      throw err;
    }
  }
};

module.exports = {
  saveWithControlNumberRetry,
};