// Controlador de Horarios de Clase (ClassSchedule)
// CRUD de horarios con aislamiento multi-tenant.
// Cada documento representa una materia asignada a un grupo con su maestro,
// indicando en qué días y módulos de la campana se imparte.
const mongoose = require("mongoose");
const ClassSchedule = require("../models/ClassSchedule.model");
const SchoolShift = require("../models/SchoolShift.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// GET /api/class-schedules
// Query params opcionales: school_year_id, group_id, teacher_id, subject_id
const getAllSchedules = async (req, res, next) => {
  try {
    const filter = { ...tenantFilter(req), isActive: true };

    if (req.query.school_year_id && mongoose.Types.ObjectId.isValid(req.query.school_year_id)) {
      filter.school_year_id = req.query.school_year_id;
    }
    if (req.query.group_id && mongoose.Types.ObjectId.isValid(req.query.group_id)) {
      filter.group_id = req.query.group_id;
    }
    if (req.query.teacher_id && mongoose.Types.ObjectId.isValid(req.query.teacher_id)) {
      filter.teacher_id = req.query.teacher_id;
    }
    if (req.query.subject_id && mongoose.Types.ObjectId.isValid(req.query.subject_id)) {
      filter.subject_id = req.query.subject_id;
    }

    const schedules = await ClassSchedule.find(filter)
      .populate("group_id", "grade section shift type")
      .populate("subject_id", "code name color icon")
      .populate("teacher_id", "name last_name")
      .populate("school_shift_id", "name shift startTime endTime")
      .sort({ group_id: 1, subject_id: 1 });

    res.status(200).json(schedules);
  } catch (error) {
    next(error);
  }
};

// POST /api/class-schedules
// Valida empalmes de maestro y grupo antes de crear.
const createSchedule = async (req, res, next) => {
  try {
    const isSuperAdmin = req.payload.role === "super_admin";
    const payload = { ...req.body };

    if (isSuperAdmin) {
      if (!payload.school) {
        return res
          .status(400)
          .json({ message: "school is required in body for super_admin." });
      }
    } else {
      payload.school = req.payload.schoolId;
    }

    // Validar que el turno exista y pertenezca al tenant
    if (!payload.school_shift_id || !mongoose.Types.ObjectId.isValid(payload.school_shift_id)) {
      return res.status(400).json({ message: "Valid school_shift_id is required." });
    }

    const shift = await SchoolShift.findOne({
      _id: payload.school_shift_id,
      ...tenantFilter(req),
    });

    if (!shift) {
      return res.status(404).json({ message: "School shift not found." });
    }

    // Validar timeBlockRefs: no recesos y contigüidad
    if (Array.isArray(payload.scheduleSlots)) {
      for (const slot of payload.scheduleSlots) {
        if (!Array.isArray(slot.timeBlockRefs) || slot.timeBlockRefs.length === 0) {
          return res.status(400).json({
            message: `Slot for day ${slot.dayOfWeek} must have at least one time block.`,
          });
        }

        // Verificar que no sean recesos
        const blocks = shift.resolveBlocks(slot.timeBlockRefs);
        const breakBlock = blocks.find((b) => b.isBreak);
        if (breakBlock) {
          return res.status(400).json({
            message: `Time block "${breakBlock.name}" is a break and cannot be assigned.`,
          });
        }

        // Verificar contigüidad
        if (!shift.areContiguous(slot.timeBlockRefs)) {
          return res.status(400).json({
            message: `Time blocks for day ${slot.dayOfWeek} must be contiguous.`,
          });
        }
      }

      // Verificar empalmes de maestro
      const teacherBlockQuery = {
        school: payload.school,
        school_year_id: payload.school_year_id,
        teacher_id: payload.teacher_id,
        isActive: true,
      };
      if (payload._id) {
        teacherBlockQuery._id = { $ne: payload._id };
      }

      for (const slot of payload.scheduleSlots) {
        const conflict = await ClassSchedule.findOne({
          ...teacherBlockQuery,
          scheduleSlots: {
            $elemMatch: {
              dayOfWeek: slot.dayOfWeek,
              timeBlockRefs: { $in: slot.timeBlockRefs },
            },
          },
        }).lean();

        if (conflict) {
          return res.status(409).json({
            message: `Teacher conflict on day ${slot.dayOfWeek}: already assigned in another schedule.`,
          });
        }
      }

      // Verificar empalmes de grupo
      const groupBlockQuery = {
        school: payload.school,
        school_year_id: payload.school_year_id,
        group_id: payload.group_id,
        isActive: true,
      };
      if (payload._id) {
        groupBlockQuery._id = { $ne: payload._id };
      }

      for (const slot of payload.scheduleSlots) {
        const conflict = await ClassSchedule.findOne({
          ...groupBlockQuery,
          scheduleSlots: {
            $elemMatch: {
              dayOfWeek: slot.dayOfWeek,
              timeBlockRefs: { $in: slot.timeBlockRefs },
            },
          },
        }).lean();

        if (conflict) {
          return res.status(409).json({
            message: `Group conflict on day ${slot.dayOfWeek}: another subject is assigned at the same time.`,
          });
        }
      }
    }

    const newSchedule = await ClassSchedule.create(payload);
    const populated = await ClassSchedule.findById(newSchedule._id)
      .populate("group_id", "grade section shift type")
      .populate("subject_id", "code name color icon")
      .populate("teacher_id", "name last_name")
      .populate("school_shift_id", "name shift startTime endTime");

    res.status(201).json(populated);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/class-schedules/:scheduleId
const deleteSchedule = async (req, res, next) => {
  try {
    const { scheduleId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(scheduleId)) {
      return res.status(404).json({ message: `No schedule with id: ${scheduleId}` });
    }

    const deleted = await ClassSchedule.findOneAndDelete({
      _id: scheduleId,
      ...tenantFilter(req),
    });

    if (!deleted) {
      return res.status(404).json({ message: `No schedule with id: ${scheduleId}` });
    }

    res.status(200).json({ message: "Schedule deleted successfully" });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllSchedules,
  createSchedule,
  deleteSchedule,
};
