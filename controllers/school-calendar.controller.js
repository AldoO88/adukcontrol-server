// Controller de Calendario Escolar (SchoolCalendar)
// CRUD de días festivos, vacaciones, suspensiones, no lectivos y
// `special_schedule` (días lectivos con horario modificado).
const mongoose = require("mongoose");
const SchoolCalendar = require("../models/SchoolCalendar.model");
const SchoolYear = require("../models/SchoolYear.model");
const SchoolShift = require("../models/SchoolShift.model");

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (hhmm) => {
  if (typeof hhmm !== "string" || !TIME_PATTERN.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Tipos del calendario que NO son lectivos. Un día lectivo (con o sin
// horario especial) usa `isSchoolDay === true`.
const CALENDAR_TYPES = [
  "holiday",
  "vacation",
  "suspension",
  "non_lectivo",
  "special_schedule",
];

// Valida los campos `special_entry_time` / `special_exit_time` contra los
// turnos activos del ciclo. Regla: la entrada especial nunca puede ser
// anterior al startTime del turno más temprano (los alumnos no se citan
// antes de la hora oficial de la escuela), y la salida especial nunca puede
// ser posterior al endTime del turno más tardío.
//
// Retorna { ok: true } o { ok: false, message }.
// Si no hay turnos configurados para el ciclo, no aplica bound validation
// (igual valida el formato HH:mm arriba).
const validateSpecialScheduleBounds = async (schoolYearId, schoolId, specialEntry, specialExit) => {
  const shifts = await SchoolShift.find({
    school: schoolId,
    school_year_id: schoolYearId,
    isActive: true,
  })
    .select("startTime endTime")
    .lean();

  if (shifts.length === 0) {
    // Sin turnos activos: no hay contra qué validar. Los campos ya pasaron
    // el regex HH:mm en el schema.
    return { ok: true };
  }

  let earliestStart = Infinity;
  let latestEnd = -Infinity;
  for (const s of shifts) {
    const sMin = toMinutes(s.startTime);
    const eMin = toMinutes(s.endTime);
    if (sMin !== null && sMin < earliestStart) earliestStart = sMin;
    if (eMin !== null && eMin > latestEnd) latestEnd = eMin;
  }

  if (specialEntry) {
    const mins = toMinutes(specialEntry);
    if (mins !== null && mins < earliestStart) {
      return {
        ok: false,
        message: `special_entry_time (${specialEntry}) is earlier than the earliest shift startTime (${minutesToHHmm(
          earliestStart
        )}).`,
      };
    }
  }
  if (specialExit) {
    const mins = toMinutes(specialExit);
    if (mins !== null && mins > latestEnd) {
      return {
        ok: false,
        message: `special_exit_time (${specialExit}) is later than the latest shift endTime (${minutesToHHmm(
          latestEnd
        )}).`,
      };
    }
  }
  return { ok: true };
};

const minutesToHHmm = (m) => {
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
};

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// GET /api/school-calendar
// Lista registros del calendario para un ciclo escolar.
const getSchoolCalendarController = async (req, res, next) => {
  try {
    const { school_year_id, type, from, to, page = 1, limit = 100 } = req.query;

    const filter = { ...tenantFilter(req), is_active: true };

    if (school_year_id) {
      if (!mongoose.Types.ObjectId.isValid(school_year_id)) {
        return res.status(400).json({ message: "Invalid school_year_id." });
      }
      filter.school_year_id = school_year_id;
    }

    if (type && CALENDAR_TYPES.includes(type)) {
      filter.type = type;
    }

    if (from || to) {
      filter.date = {};
      if (from) {
        const fromDate = new Date(from);
        if (Number.isNaN(fromDate.getTime())) {
          return res.status(400).json({ message: "from is not a valid date." });
        }
        filter.date.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (Number.isNaN(toDate.getTime())) {
          return res.status(400).json({ message: "to is not a valid date." });
        }
        filter.date.$lte = toDate;
      }
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      SchoolCalendar.find(filter)
        .sort({ date: 1 })
        .skip(skip)
        .limit(limitNum),
      SchoolCalendar.countDocuments(filter),
    ]);

    res.status(200).json({
      items,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum) || 1,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/school-calendar
// Crea un registro en el calendario escolar. Si `type === "special_schedule"`
// los campos `special_entry_time` y/o `special_exit_time` se validan contra
// los turnos activos del ciclo (entry >= earliest startTime, exit <= latest
// endTime).
const createSchoolCalendarController = async (req, res, next) => {
  try {
    const {
      school_year_id,
      date,
      type,
      name,
      special_entry_time,
      special_exit_time,
    } = req.body;
    const isSuperAdmin = req.payload.role === "super_admin";
    const schoolId = isSuperAdmin ? req.body.school : req.payload.schoolId;

    if (!schoolId) {
      return res
        .status(400)
        .json({ message: "schoolId is required in token." });
    }

    if (!school_year_id || !date || !type) {
      return res
        .status(400)
        .json({ message: "school_year_id, date, and type are required." });
    }

    if (!CALENDAR_TYPES.includes(type)) {
      return res.status(400).json({
        message: `type must be one of: ${CALENDAR_TYPES.join(", ")}.`,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(school_year_id)) {
      return res.status(400).json({ message: "Invalid school_year_id." });
    }

    const dateObj = new Date(date);
    if (Number.isNaN(dateObj.getTime())) {
      return res.status(400).json({ message: "date is not a valid ISO 8601 date." });
    }

    // Normalizar a inicio del día
    dateObj.setUTCHours(0, 0, 0, 0);

    // Para special_schedule exigir al menos uno de los dos horarios y validar
    // los bounds contra los turnos del ciclo.
    if (type === "special_schedule") {
      if (!special_entry_time && !special_exit_time) {
        return res.status(400).json({
          message:
            "special_schedule requires at least one of special_entry_time or special_exit_time.",
        });
      }
      const boundsCheck = await validateSpecialScheduleBounds(
        school_year_id,
        schoolId,
        special_entry_time || null,
        special_exit_time || null
      );
      if (!boundsCheck.ok) {
        return res.status(400).json({ message: boundsCheck.message });
      }
    }

    const entry = await SchoolCalendar.create({
      school: schoolId,
      school_year_id,
      date: dateObj,
      type,
      name: name || null,
      special_entry_time: type === "special_schedule" ? special_entry_time || null : null,
      special_exit_time: type === "special_schedule" ? special_exit_time || null : null,
    });

    res.status(201).json({
      success: true,
      entry,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ message: "A calendar entry already exists for this date." });
    }
    next(error);
  }
};

// PUT /api/school-calendar/:entryId
// Actualiza un registro del calendario. Si el `type` final es
// `special_schedule`, se revalidan `special_entry_time` / `special_exit_time`
// contra los turnos del ciclo. Si se cambia el type a uno no-lectivo, los
// horarios especiales se limpian.
const updateSchoolCalendarController = async (req, res, next) => {
  try {
    const { entryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      return res.status(400).json({ message: "Invalid entryId." });
    }

    const {
      type,
      name,
      is_active,
      special_entry_time,
      special_exit_time,
    } = req.body;
    const updates = {};
    if (type !== undefined) {
      if (!CALENDAR_TYPES.includes(type)) {
        return res.status(400).json({
          message: `type must be one of: ${CALENDAR_TYPES.join(", ")}.`,
        });
      }
      updates.type = type;
    }
    if (name !== undefined) updates.name = name;
    if (is_active !== undefined) updates.is_active = is_active;
    if (special_entry_time !== undefined) updates.special_entry_time = special_entry_time || null;
    if (special_exit_time !== undefined) updates.special_exit_time = special_exit_time || null;

    // Buscar el entry actual para validar bounds si el type final es special.
    const existing = await SchoolCalendar.findOne({
      _id: entryId,
      ...tenantFilter(req),
    });
    if (!existing) {
      return res.status(404).json({ message: "Calendar entry not found." });
    }

    const finalType = updates.type || existing.type;
    if (finalType === "special_schedule") {
      const entryToUse =
        updates.special_entry_time !== undefined
          ? updates.special_entry_time
          : existing.special_entry_time;
      const exitToUse =
        updates.special_exit_time !== undefined
          ? updates.special_exit_time
          : existing.special_exit_time;
      if (!entryToUse && !exitToUse) {
        return res.status(400).json({
          message:
            "special_schedule requires at least one of special_entry_time or special_exit_time.",
        });
      }
      const boundsCheck = await validateSpecialScheduleBounds(
        existing.school_year_id,
        existing.school,
        entryToUse,
        exitToUse
      );
      if (!boundsCheck.ok) {
        return res.status(400).json({ message: boundsCheck.message });
      }
    } else if (finalType !== "special_schedule") {
      // Si el type deja de ser special_schedule, limpiar los horarios
      // especiales para que no persistan inútilmente.
      updates.special_entry_time = null;
      updates.special_exit_time = null;
    }

    const entry = await SchoolCalendar.findOneAndUpdate(
      { _id: entryId, ...tenantFilter(req) },
      { $set: updates },
      { new: true }
    );

    res.status(200).json({
      success: true,
      entry,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/school-calendar/:entryId
// Elimina un registro del calendario (soft delete: is_active = false).
const deleteSchoolCalendarController = async (req, res, next) => {
  try {
    const { entryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      return res.status(400).json({ message: "Invalid entryId." });
    }

    const entry = await SchoolCalendar.findOneAndUpdate(
      { _id: entryId, ...tenantFilter(req) },
      { $set: { is_active: false } },
      { new: true }
    );

    if (!entry) {
      return res.status(404).json({ message: "Calendar entry not found." });
    }

    res.status(200).json({
      success: true,
      message: "Calendar entry deactivated.",
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/school-calendar/weekends
// Marca todas las ocurrencias de los weekdays solicitados (0=Dom..6=Sáb)
// dentro del rango startDate..endDate del ciclo como "non_lectivo".
//
// Body: { school_year_id, weekdays: [0..6] }
//
// Devuelve { total, created, skipped, days_of_week, sample_dates }.
// NO sobrescribe entries existentes con type distinto (los skippea como
// "skipped" en el resultado). Para borrar un día, hay que hacerlo
// manualmente desde la UI del calendar (decisión de scope).
const bulkMarkWeekends = async (req, res, next) => {
  try {
    const { school_year_id, weekdays } = req.body || {};

    if (
      !school_year_id ||
      !mongoose.Types.ObjectId.isValid(school_year_id)
    ) {
      return res
        .status(400)
        .json({ message: "Valid school_year_id is required." });
    }
    if (!Array.isArray(weekdays) || weekdays.length === 0) {
      return res
        .status(400)
        .json({ message: "weekdays must be a non-empty array." });
    }
    for (const d of weekdays) {
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        return res
          .status(400)
          .json({ message: `Invalid weekday: ${d}. Must be 0-6.` });
      }
    }

    // Buscar el ciclo para obtener el rango de fechas
    const year = await SchoolYear.findById(school_year_id).lean();
    if (!year) {
      return res.status(404).json({ message: "School year not found." });
    }

    // Multi-tenant check
    const isSuperAdmin = req.payload.role === "super_admin";
    if (!isSuperAdmin) {
      if (String(year.school) !== String(req.payload.schoolId)) {
        return res.status(403).json({ message: "School year not in your tenant." });
      }
    }

    const start = new Date(year.startDate);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(year.endDate);
    end.setUTCHours(0, 0, 0, 0);

    if (start > end) {
      return res
        .status(400)
        .json({ message: "School year startDate is after endDate." });
    }

    // Generar todas las ocurrencias
    const dates = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (weekdays.includes(d.getUTCDay())) {
        dates.push(new Date(d));
      }
    }

    // bulkWrite con ordered:false para no fallar en duplicados
    const schoolId = isSuperAdmin ? year.school : req.payload.schoolId;
    const ops = dates.map((d) => ({
      insertOne: {
        document: {
          school: schoolId,
          school_year_id: school_year_id,
          date: d,
          type: "non_lectivo",
          is_active: true,
        },
      },
    }));

    let inserted = 0;
    let skipped = 0;
    if (ops.length > 0) {
      const result = await SchoolCalendar.bulkWrite(ops, {
        ordered: false,
      });
      inserted = result.insertedCount || 0;
      // writeErrors indica cuántos docs fallaron por duplicado u
      // otro error de validación (e.g. unique key en school+year+date).
      const writeErrors = result.writeErrors || [];
      skipped = writeErrors.length;
    }

    res.status(200).json({
      total: dates.length,
      created: inserted,
      skipped,
      days_of_week: weekdays,
      sample_dates: dates.slice(0, 5),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSchoolCalendarController,
  createSchoolCalendarController,
  updateSchoolCalendarController,
  deleteSchoolCalendarController,
  bulkMarkWeekends,
};
