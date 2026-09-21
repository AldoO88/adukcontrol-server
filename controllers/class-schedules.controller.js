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

// POST /api/class-schedules/bulk
// Crea múltiples horarios en una sola transacción lógica (no real — cada
// createSchedule es independiente). Cada item pasa por las MISMAS
// validaciones que createSchedule (break check, contigüidad, empalmes
// de maestro, empalmes de grupo). Devuelve un array con el resultado
// por item para que la UI pueda mostrar qué falló.
//
// Body shape:
//   { school_year_id, school_shift_id, items: [{ teacher_id, subject_id,
//     group_id, scheduleSlots }, ...] }
//
// Auth: admin/registrar/super_admin (igual que createSchedule).
const bulkCreate = async (req, res, next) => {
  try {
    const { school_year_id, school_shift_id, items } = req.body;

    if (!school_year_id || !mongoose.Types.ObjectId.isValid(school_year_id)) {
      return res.status(400).json({ message: "Valid school_year_id is required." });
    }
    if (!school_shift_id || !mongoose.Types.ObjectId.isValid(school_shift_id)) {
      return res.status(400).json({ message: "Valid school_shift_id is required." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ message: "items must be a non-empty array." });
    }
    if (items.length > 500) {
      return res
        .status(400)
        .json({ message: "items array exceeds 500 entries." });
    }

    const isSuperAdmin = req.payload.role === "super_admin";
    const school = isSuperAdmin ? req.body.school : req.payload.schoolId;
    if (!school) {
      return res
        .status(400)
        .json({ message: "school is required in body for super_admin." });
    }

    const shift = await SchoolShift.findOne({
      _id: school_shift_id,
      ...(isSuperAdmin ? { school } : { school: req.payload.schoolId }),
    });
    if (!shift) {
      return res.status(404).json({ message: "School shift not found." });
    }

    // Validamos todos los items primero en modo dry-run (sin escribir) para
    // detectar conflictos rápidamente. Si pasa todo, creamos en orden.
    const results = [];
    const validPayloads = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const idx = item._index ?? i;

      const validation = await validateScheduleSlot(item, shift, school, {
        school_year_id,
        teacher_id: item.teacher_id,
        group_id: item.group_id,
        subject_id: item.subject_id,
      });
      if (!validation.ok) {
        results.push({
          index: idx,
          status: "error",
          errors: validation.errors,
        });
        continue;
      }

      // Si pasa validación, armar el payload y agregarlo para crear.
      validPayloads.push({
        index: idx,
        payload: {
          school,
          school_year_id,
          school_shift_id,
          teacher_id: item.teacher_id,
          group_id: item.group_id,
          subject_id: item.subject_id,
          classroom: item.classroom || null,
          scheduleSlots: item.scheduleSlots,
          isActive: true,
        },
      });
    }

    // Insertar en orden. Cada save genera su propio ID.
    const created = [];
    for (const { index, payload } of validPayloads) {
      try {
        const newSched = await ClassSchedule.create(payload);
        created.push({ index, status: "ok", _id: newSched._id });
      } catch (err) {
        // Si un item específico falla al guardar (p.ej. unique constraint
        // al crear dos ClassSchedule con mismo {group,subject,teacher,year}),
        // lo reportamos pero NO rollback los ya creados — el UI puede
        // mostrar los exitosos y pedir retry solo de los fallidos.
        results.push({
          index,
          status: "error",
          errors: [
            err.code === 11000
              ? "Duplicate (this teacher-subject-group already has a schedule)"
              : err.message,
          ],
        });
      }
    }

    // Combinar todos los results en orden de index.
    const allResults = [
      ...results.filter((r) => r.status === "error"),
      ...created,
    ].sort((a, b) => a.index - b.index);

    const succeeded = created.length;
    const failed = results.filter((r) => r.status === "error").length;

    res.status(200).json({
      total: items.length,
      succeeded,
      failed,
      results: allResults,
    });
  } catch (error) {
    next(error);
  }
};

// Helper extraído: valida un slot contra el shift y los conflictos.
// Devuelve { ok: true } o { ok: false, errors: [...] }.
const validateScheduleSlot = async (
  item,
  shift,
  school,
  ctx
) => {
  const errors = [];

  if (!ctx.teacher_id || !mongoose.Types.ObjectId.isValid(ctx.teacher_id)) {
    errors.push("teacher_id is required and must be a valid ObjectId");
  }
  if (!ctx.subject_id || !mongoose.Types.ObjectId.isValid(ctx.subject_id)) {
    errors.push("subject_id is required and must be a valid ObjectId");
  }
  if (!ctx.group_id || !mongoose.Types.ObjectId.isValid(ctx.group_id)) {
    errors.push("group_id is required and must be a valid ObjectId");
  }

  if (errors.length > 0) return { ok: false, errors };

  if (!Array.isArray(item.scheduleSlots) || item.scheduleSlots.length === 0) {
    return {
      ok: false,
      errors: ["scheduleSlots must be a non-empty array"],
    };
  }

  // Check breaks + contigüidad por slot.
  for (const slot of item.scheduleSlots) {
    if (!Array.isArray(slot.timeBlockRefs) || slot.timeBlockRefs.length === 0) {
      errors.push(
        `Slot for day ${slot.dayOfWeek} must have at least one time block.`
      );
      continue;
    }
    const blocks = shift.resolveBlocks(slot.timeBlockRefs);
    const breakBlock = blocks.find((b) => b.isBreak);
    if (breakBlock) {
      errors.push(
        `Time block "${breakBlock.name}" is a break and cannot be assigned.`
      );
      continue;
    }
    if (!shift.areContiguous(slot.timeBlockRefs)) {
      errors.push(
        `Time blocks for day ${slot.dayOfWeek} must be contiguous.`
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Empalme maestro contra schedules existentes + los ya validados en este batch.
  for (const slot of item.scheduleSlots) {
    const existingConflict = await ClassSchedule.findOne({
      school,
      school_year_id: ctx.school_year_id,
      teacher_id: ctx.teacher_id,
      isActive: true,
      scheduleSlots: {
        $elemMatch: {
          dayOfWeek: slot.dayOfWeek,
          timeBlockRefs: { $in: slot.timeBlockRefs },
        },
      },
    }).lean();
    if (existingConflict) {
      errors.push(
        `Teacher conflict on day ${slot.dayOfWeek}: already assigned in another schedule.`
      );
    }
  }

  // Empalme grupo.
  for (const slot of item.scheduleSlots) {
    const existingConflict = await ClassSchedule.findOne({
      school,
      school_year_id: ctx.school_year_id,
      group_id: ctx.group_id,
      isActive: true,
      scheduleSlots: {
        $elemMatch: {
          dayOfWeek: slot.dayOfWeek,
          timeBlockRefs: { $in: slot.timeBlockRefs },
        },
      },
    }).lean();
    if (existingConflict) {
      errors.push(
        `Group conflict on day ${slot.dayOfWeek}: another subject is assigned at the same time.`
      );
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
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
  bulkCreate,
  deleteSchedule,
};
