// Controller de Marcación Automática de Ausencias
// Endpoint manual para que admin/registrar dispare el marcado de ausencias
// fuera del horario del cronjob (fallback o backfill manual).
const mongoose = require("mongoose");
const School = require("../models/School.model");
const AttendanceLog = require("../models/AttendanceLog.model");
const attendanceService = require("../services/attendance.service");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// POST /api/attendance/mark-absences
// Marca ausencias automáticas para alumnos sin entry en la fecha de hoy
// (o en una fecha específica).
const markAbsencesController = async (req, res, next) => {
  try {
    const { date } = req.body;
    const schoolId = req.payload.schoolId;

    if (!schoolId) {
      return res
        .status(400)
        .json({ message: "schoolId is required in token." });
    }

    const school = await School.findById(schoolId).select(
      "current_school_year_id name"
    );
    if (!school) {
      return res.status(404).json({ message: "School not found." });
    }
    if (!school.current_school_year_id) {
      return res
        .status(400)
        .json({ message: "No active school year for this school." });
    }

    const targetDate = date ? new Date(date) : undefined;
    if (date && Number.isNaN(targetDate.getTime())) {
      return res
        .status(400)
        .json({ message: "date is not a valid ISO 8601 date." });
    }

    const result = await attendanceService.markAbsencesForSchool(
      schoolId,
      school.current_school_year_id,
      targetDate
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/attendance/logs/:logId/justify
// Justifica una ausencia (solo admin/registrar).
const justifyAttendanceLogController = async (req, res, next) => {
  try {
    const { logId } = req.params;
    const { justified, justified_reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(logId)) {
      return res.status(400).json({ message: "Invalid logId." });
    }

    const log = await AttendanceLog.findOne({
      _id: logId,
      ...tenantFilter(req),
    });

    if (!log) {
      return res.status(404).json({ message: "Attendance log not found." });
    }

    if (log.status !== "absent") {
      return res
        .status(400)
        .json({ message: "Only absent logs can be justified." });
    }

    log.justified = Boolean(justified);
    log.justified_reason = justified
      ? justified_reason || "Justified by admin"
      : null;
    log.justified_at = justified ? new Date() : null;

    await log.save();

    res.status(200).json({
      success: true,
      log,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  markAbsencesController,
  justifyAttendanceLogController,
};
