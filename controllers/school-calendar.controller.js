// Controller de Calendario Escolar (SchoolCalendar)
// CRUD de días festivos, vacaciones, suspensiones y días no lectivos.
const mongoose = require("mongoose");
const SchoolCalendar = require("../models/SchoolCalendar.model");
const SchoolYear = require("../models/SchoolYear.model");

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

    if (type && ["holiday", "vacation", "suspension", "non_lectivo"].includes(type)) {
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
// Crea un registro en el calendario escolar.
const createSchoolCalendarController = async (req, res, next) => {
  try {
    const { school_year_id, date, type, name } = req.body;
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

    if (!mongoose.Types.ObjectId.isValid(school_year_id)) {
      return res.status(400).json({ message: "Invalid school_year_id." });
    }

    const dateObj = new Date(date);
    if (Number.isNaN(dateObj.getTime())) {
      return res.status(400).json({ message: "date is not a valid ISO 8601 date." });
    }

    // Normalizar a inicio del día
    dateObj.setUTCHours(0, 0, 0, 0);

    const entry = await SchoolCalendar.create({
      school: schoolId,
      school_year_id,
      date: dateObj,
      type,
      name: name || null,
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
// Actualiza un registro del calendario.
const updateSchoolCalendarController = async (req, res, next) => {
  try {
    const { entryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(entryId)) {
      return res.status(400).json({ message: "Invalid entryId." });
    }

    const { type, name, is_active } = req.body;
    const updates = {};
    if (type !== undefined) updates.type = type;
    if (name !== undefined) updates.name = name;
    if (is_active !== undefined) updates.is_active = is_active;

    const entry = await SchoolCalendar.findOneAndUpdate(
      { _id: entryId, ...tenantFilter(req) },
      { $set: updates },
      { new: true }
    );

    if (!entry) {
      return res.status(404).json({ message: "Calendar entry not found." });
    }

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
