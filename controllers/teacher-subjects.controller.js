// Controlador de Asignaciones Maestro-Materia-Grupo (TeacherSubject)
// CRUD de la matriz de permisos: qué maestro enseña qué materia a qué
// grupo en qué año. Es la base para que un teacher solo pueda calificar
// a los alumnos donde efectivamente da clase.
const mongoose = require("mongoose");
const TeacherSubject = require("../models/TeacherSubject.model");
const User = require("../models/User.model");
const Group = require("../models/Group.model");
const Subject = require("../models/Subject.model");
const School = require("../models/School.model");
const ClassSchedule = require("../models/ClassSchedule.model");
const SchoolShift = require("../models/SchoolShift.model");
const Student = require("../models/Student.model");
const Enrollment = require("../models/Enrollment.model");
const { toMinutes } = require("../models/SchoolShift.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin"
    ? {}
    : { school: req.payload.schoolId };

// GET /api/teacher-subjects
// Lista las asignaciones. Filtros: ?teacher_id, ?group_id, ?subject_id, ?school_year_id
const getAllTeacherSubjects = async (req, res, next) => {
  try {
    const filter = { ...tenantFilter(req) };
    if (req.query.teacher_id && mongoose.Types.ObjectId.isValid(req.query.teacher_id)) {
      filter.teacher_id = req.query.teacher_id;
    }
    if (req.query.group_id && mongoose.Types.ObjectId.isValid(req.query.group_id)) {
      filter.group_id = req.query.group_id;
    }
    if (req.query.subject_id && mongoose.Types.ObjectId.isValid(req.query.subject_id)) {
      filter.subject_id = req.query.subject_id;
    }
    if (req.query.school_year_id && mongoose.Types.ObjectId.isValid(req.query.school_year_id)) {
      filter.school_year_id = req.query.school_year_id;
    }

    const assignments = await TeacherSubject.find(filter)
      .populate("teacher_id", "name email role phoneNumber")
      .populate("subject_id", "code name")
      .populate("group_id", "grade section school_year_id shift")
      .populate("school_year_id", "name startDate endDate isActive")
      .sort({ "teacher_id.name": 1 });

    res.status(200).json({ items: assignments, total: assignments.length });
  } catch (error) {
    next(error);
  }
};

// POST /api/teacher-subjects
// Crea una asignación. Auth: admin/registrar.
const createTeacherSubject = async (req, res, next) => {
  try {
    const { teacher_id, subject_id, group_id, school_year_id } = req.body;

    if (!teacher_id || !subject_id || !group_id || !school_year_id) {
      return res
        .status(400)
        .json({ message: "teacher_id, subject_id, group_id, school_year_id are required." });
    }
    if (!mongoose.Types.ObjectId.isValid(teacher_id)) {
      return res.status(400).json({ message: "Invalid teacher_id." });
    }
    if (!mongoose.Types.ObjectId.isValid(subject_id)) {
      return res.status(400).json({ message: "Invalid subject_id." });
    }
    if (!mongoose.Types.ObjectId.isValid(group_id)) {
      return res.status(400).json({ message: "Invalid group_id." });
    }
    if (!mongoose.Types.ObjectId.isValid(school_year_id)) {
      return res.status(400).json({ message: "Invalid school_year_id." });
    }

    // Verificar que el teacher existe y es role=teacher
    const teacher = await User.findById(teacher_id);
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found." });
    }
    if (teacher.role !== "teacher" && teacher.role !== "admin" && teacher.role !== "registrar") {
      return res
        .status(400)
        .json({ message: `User with role '${teacher.role}' cannot be assigned as teacher.` });
    }

    // Verificar que la materia existe y pertenece al tenant
    const subject = await Subject.findOne({
      _id: subject_id,
      ...tenantFilter(req),
    });
    if (!subject) {
      return res.status(404).json({ message: "Subject not found in this tenant." });
    }

    // Verificar que el group existe y pertenece al tenant
    const group = await Group.findOne({
      _id: group_id,
      ...tenantFilter(req),
    });
    if (!group) {
      return res.status(404).json({ message: "Group not found in this tenant." });
    }
    if (group.school_year_id.toString() !== school_year_id) {
      return res
        .status(400)
        .json({ message: `Group school_year_id (${group.school_year_id}) doesn't match the assignment (${school_year_id}).` });
    }

    const school = req.payload.schoolId || req.body.school;
    const assignment = await TeacherSubject.create({
      school: school || group.school,
      teacher_id,
      subject_id,
      group_id,
      school_year_id,
    });
    res.status(201).json(assignment);
  } catch (error) {
    // Duplicate key (mismo teacher+subject+group+year)
    if (error.code === 11000) {
      return res.status(409).json({
        message: "This teacher is already assigned to this subject/group/year.",
      });
    }
    next(error);
  }
};

// DELETE /api/teacher-subjects/:id
const deleteTeacherSubject = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "Assignment not found." });
    }
    const deleted = await TeacherSubject.findOneAndDelete({
      _id: id,
      ...tenantFilter(req),
    });
    if (!deleted) {
      return res.status(404).json({ message: "Assignment not found." });
    }
    res.status(200).json({ message: "Assignment deleted successfully." });
  } catch (error) {
    next(error);
  }
};

// GET /api/teacher-subjects/me/dashboard
// Devuelve datos del maestro para su dashboard: escuela, horario del día, clase en curso
const getTeacherDashboard = async (req, res, next) => {
  try {
    const teacherId = req.payload._id;
    const schoolId = req.school;
    const schoolYearId = req.schoolYear;

    // 1. Datos del maestro + escuela + ciclo activo en paralelo
    const [user, schoolDoc] = await Promise.all([
      User.findById(teacherId)
        .select("name last_name email phoneNumber role school")
        .lean(),
      School.findById(schoolId)
        .select("name cct logoUrl isActive current_school_year_id")
        .populate("current_school_year_id", "name startDate endDate isActive")
        .lean(),
    ]);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    if (!schoolDoc) {
      return res.status(404).json({ message: "School not found." });
    }

    const currentSchoolYear = schoolDoc.current_school_year_id || null;

    // 2. Horario del maestro para el día de hoy
    const now = new Date();
    const today = now.getDay(); // 0=domingo...6=sábado
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Buscar todos los ClassSchedule del maestro en este ciclo
    const schedules = await ClassSchedule.find({
      school: schoolId,
      school_year_id: schoolYearId,
      teacher_id: teacherId,
      isActive: true,
    })
      .populate("group_id", "grade section shift")
      .populate("subject_id", "code name")
      .populate("school_shift_id", "timeBlocks")
      .lean();

    // Filtrar solo los slots de hoy
    const todayClasses = [];
    for (const sched of schedules) {
      for (const slot of sched.scheduleSlots) {
        if (slot.dayOfWeek === today) {
          // Resolver los timeBlocks del SchoolShift
          const shift = sched.school_shift_id;
          const blocks = shift
            ? shift.timeBlocks.filter((b) =>
                slot.timeBlockRefs.map(String).includes(String(b._id))
              )
            : [];

          if (blocks.length > 0) {
            // Ordenar bloques por order
            blocks.sort((a, b) => a.order - b.order);
            const startTime = blocks[0].startTime;
            const endTime = blocks[blocks.length - 1].endTime;
            const startMin = toMinutes(startTime);
            const endMin = toMinutes(endTime);

            todayClasses.push({
              subject: sched.subject_id
                ? { _id: sched.subject_id._id, code: sched.subject_id.code, name: sched.subject_id.name }
                : null,
              group: sched.group_id
                ? {
                    _id: sched.group_id._id,
                    grade: sched.group_id.grade,
                    section: sched.group_id.section,
                    label: `${sched.group_id.grade}°${sched.group_id.section}`,
                  }
                : null,
              startTime,
              endTime,
              startMinutes: startMin,
              endMinutes: endMin,
              classroom: slot.classroom || null,
            });
          }
        }
      }
    }

    // Ordenar por hora de inicio
    todayClasses.sort((a, b) => a.startMinutes - b.startMinutes);

    // 3. Determinar clase en curso, completadas y resto del día
    let currentClass = null;
    const completedClasses = [];
    const restOfDay = [];

    for (const cls of todayClasses) {
      if (currentMinutes >= cls.startMinutes && currentMinutes < cls.endMinutes) {
        currentClass = { ...cls, status: "current" };
        completedClasses.push({ ...cls, status: "completed" });
      } else if (currentMinutes >= cls.endMinutes) {
        completedClasses.push({ ...cls, status: "completed" });
      } else {
        restOfDay.push({ ...cls, status: "upcoming" });
      }
    }

    // 4. Formatear fechas en español
    const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const months = [
      "enero", "febrero", "marzo", "abril", "mayo", "junio",
      "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    ];
    const dateStr = `${days[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]}`;

    // Formatear hora actual en 12h
    const formatTime12 = (date) => {
      let h = date.getHours();
      const m = date.getMinutes().toString().padStart(2, "0");
      const ampm = h >= 12 ? "p.m." : "a.m.";
      h = h % 12 || 12;
      return `${h}:${m} ${ampm}`;
    };

    // 5. Construir respuesta
    res.status(200).json({
      // Datos del maestro
      teacher: {
        _id: user._id,
        name: user.name,
        last_name: user.last_name,
        fullName: `${user.name} ${user.last_name || ""}`.trim(),
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
      // Datos de la escuela
      school: {
        _id: schoolDoc._id,
        name: schoolDoc.name,
        cct: schoolDoc.cct,
        logoUrl: schoolDoc.logoUrl,
        isActive: schoolDoc.isActive,
      },
      currentSchoolYear,
      // Fecha y hora
      currentDate: dateStr,
      currentTime: formatTime12(now),
      // Horario del día
      todaySchedule: {
        totalClasses: todayClasses.length,
        completedClasses,
        currentClass,
        restOfDay,
        allClasses: todayClasses.map((cls) => {
          if (currentMinutes >= cls.startMinutes && currentMinutes < cls.endMinutes) {
            return { ...cls, status: "current" };
          } else if (currentMinutes >= cls.endMinutes) {
            return { ...cls, status: "completed" };
          }
          return { ...cls, status: "upcoming" };
        }),
      },
    });
  } catch (error) {
    console.error("getTeacherDashboard error:", error);
    next(error);
  }
};

// GET /api/teacher-subjects/me/groups/:groupId/students
// Devuelve los alumnos inscritos en un grupo para tomar asistencia
const getGroupStudents = async (req, res, next) => {
  try {
    const teacherId = req.payload._id;
    const schoolId = req.school;
    const schoolYearId = req.schoolYear;
    const { groupId } = req.params;
    const { subject_id } = req.query;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ message: "Invalid group ID." });
    }

    // 1. Verificar que el grupo existe y pertenece a la escuela
    const group = await Group.findOne({
      _id: groupId,
      school: schoolId,
      school_year_id: schoolYearId,
    }).lean();

    if (!group) {
      return res.status(404).json({ message: "Group not found." });
    }

    // 2. Verificar que el maestro tiene una asignación (TeacherSubject) para este grupo
    const assignmentFilter = {
      school: schoolId,
      teacher_id: teacherId,
      group_id: groupId,
      school_year_id: schoolYearId,
    };
    if (subject_id) {
      assignmentFilter.subject_id = subject_id;
    }
    const assignment = await TeacherSubject.findOne(assignmentFilter).lean();

    if (!assignment) {
      return res.status(403).json({ message: "You are not assigned to this group." });
    }

    // 3. Obtener los alumnos inscritos en el grupo
    const enrollments = await Enrollment.find({
      school: schoolId,
      group_id: groupId,
      school_year_id: schoolYearId,
      cycle_status: "enrolled",
    })
      .populate("student_id", "first_name last_name controlNumber photoUrl rfid_card biometricId")
      .lean();

    const students = enrollments
      .map((e) => e.student_id)
      .filter(Boolean)
      .sort((a, b) => (a.last_name || "").localeCompare(b.last_name || "") || (a.first_name || "").localeCompare(b.first_name || ""));

    // 4. Verificar si cada alumno pasó por el biométrico hoy (entry event)
    const AttendanceLog = require("../models/AttendanceLog.model");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const studentIds = students.map((s) => s._id);

    // Buscar primer evento de entrada (entry) de hoy para cada alumno
    const todayEntries = await AttendanceLog.aggregate([
      {
        $match: {
          student_id: { $in: studentIds },
          school: new mongoose.Types.ObjectId(schoolId),
          event_type: "entry",
          event_time: { $gte: today, $lt: tomorrow },
        },
      },
      {
        $group: {
          _id: "$student_id",
          firstEntry: { $min: "$event_time" },
        },
      },
    ]);

    // Mapa: studentId → hora de entrada
    const entryMap = new Map();
    for (const entry of todayEntries) {
      entryMap.set(String(entry._id), entry.firstEntry);
    }

    // 5. Verificar si ya existe asistencia guardada para esta clase hoy
    const ClassAttendance = require("../models/ClassAttendance.model");
    const resolvedSubjectId = subject_id || (assignment ? String(assignment.subject_id) : null);

    const existingAttendance = await ClassAttendance.findOne({
      school: schoolId,
      school_year_id: schoolYearId,
      group_id: groupId,
      subject_id: resolvedSubjectId,
      teacher_id: teacherId,
      date: today,
    }).lean();

    // Mapa: studentId → registro de asistencia existente
    const attendanceMap = new Map();
    if (existingAttendance && existingAttendance.records) {
      for (const record of existingAttendance.records) {
        attendanceMap.set(String(record.student_id), {
          status: record.status,
          location: record.location,
          note: record.note,
        });
      }
    }
    if (!existingAttendance) {
      console.log("No existing attendance found for group:", groupId, "subject:", resolvedSubjectId, "teacher:", teacherId, "date:", today);
    }


    // 6. Formatear respuesta
    const groupLabel = `${group.grade}°${group.section}`;

    res.status(200).json({
      group: {
        _id: group._id,
        grade: group.grade,
        section: group.section,
        label: groupLabel,
        shift: group.shift,
      },
      subject_id: resolvedSubjectId,
      // Si ya existe asistencia, incluir el ID para actualizar
      attendance_id: existingAttendance ? existingAttendance._id : null,
      // Si ya existe asistencia, incluir startTime y endTime originales
      startTime: existingAttendance ? existingAttendance.startTime : null,
      endTime: existingAttendance ? existingAttendance.endTime : null,
      students: students.map((s) => {
        const entryTime = entryMap.get(String(s._id));
        const savedAttendance = attendanceMap.get(String(s._id));
        return {
          _id: s._id,
          first_name: s.first_name,
          last_name: s.last_name,
          fullName: `${s.first_name} ${s.last_name || ""}`.trim(),
          controlNumber: s.controlNumber,
          photoUrl: s.photoUrl || null,
          rfid_card: s.rfid_card || null,
          biometricId: s.biometricId || null,
          // Estado del biométrico (si pasó por el lector)
          checked_in: !!entryTime,
          entry_time: entryTime || null,
          // Asistencia guardada previamente (si existe)
          saved_status: savedAttendance ? savedAttendance.status : null,
          saved_location: savedAttendance ? savedAttendance.location : null,
          saved_note: savedAttendance ? savedAttendance.note : null,
        };
      }),
      total: students.length,
    });

    console.log("getGroupStudents response:", {
      group: {
        _id: group._id,
        grade: group.grade,
        section: group.section,
        label: groupLabel,
        shift: group.shift,
      }
    });
  } catch (error) {
    console.error("getGroupStudents error:", error);
    next(error);
  }
};

// POST /api/teacher-subjects/me/attendance
// Registra el pase de lista de una clase
const saveAttendance = async (req, res, next) => {
  try {
    const teacherId = req.payload._id;
    const schoolId = req.school;
    const schoolYearId = req.schoolYear;

    const {
      group_id,
      subject_id,
      class_schedule_id,
      date,
      startTime,
      endTime,
      records, // [{ student_id, status, note? }]
    } = req.body;

    // 1. Validaciones básicas
    if (!group_id || !subject_id || !date || !records || !Array.isArray(records)) {
      return res.status(400).json({
        message: "group_id, subject_id, date, and records array are required.",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(group_id)) {
      return res.status(400).json({ message: "Invalid group_id." });
    }
    if (!mongoose.Types.ObjectId.isValid(subject_id)) {
      return res.status(400).json({ message: "Invalid subject_id." });
    }

    // 2. Verificar que el maestro tiene asignatura para este grupo+materia
    const assignment = await TeacherSubject.findOne({
      school: schoolId,
      teacher_id: teacherId,
      group_id,
      subject_id,
      school_year_id: schoolYearId,
    }).lean();

    if (!assignment) {
      return res.status(403).json({
        message: "You are not assigned to teach this subject in this group.",
      });
    }

    // 3. Validar que todos los student_ids sean válidos y pertenezcan al grupo
    const studentIds = records.map((r) => r.student_id);
    const validIds = studentIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length !== studentIds.length) {
      return res.status(400).json({ message: "All student_ids must be valid ObjectIds." });
    }

    const enrollments = await Enrollment.find({
      school: schoolId,
      group_id,
      school_year_id: schoolYearId,
      student_id: { $in: validIds },
      cycle_status: "enrolled",
    }).lean();

    if (enrollments.length !== validIds.length) {
      return res.status(400).json({
        message: "Some students are not enrolled in this group.",
      });
    }

    // 4. Validar statuses
    const validStatuses = ["present", "retard", "absent"];
    for (const record of records) {
      if (!validStatuses.includes(record.status)) {
        return res.status(400).json({
          message: `Invalid status '${record.status}'. Must be: present, retard, or absent.`,
        });
      }
    }

    // 5. Preparar fecha (solo día, sin hora)
    const attendanceDate = new Date(date);
    attendanceDate.setHours(0, 0, 0, 0);

    // 6. Calcular resumen
    const summary = {
      total: records.length,
      present: records.filter((r) => r.status === "present").length,
      retard: records.filter((r) => r.status === "retard").length,
      absent: records.filter((r) => r.status === "absent").length,
    };

    // 7. Upsert: si ya existe attendance para esta clase el mismo día, actualizar
    const ClassAttendance = require("../models/ClassAttendance.model");
    
    const attendance = await ClassAttendance.findOneAndUpdate(
      {
        school: schoolId,
        school_year_id: schoolYearId,
        group_id,
        subject_id,
        teacher_id: teacherId,
        date: attendanceDate,
      },
      {
        school: schoolId,
        school_year_id: schoolYearId,
        group_id,
        subject_id,
        teacher_id: teacherId,
        class_schedule_id: class_schedule_id || null,
        date: attendanceDate,
        startTime: startTime || null,
        endTime: endTime || null,
        records: records.map((r) => ({
          student_id: r.student_id,
          status: r.status,
          location: r.location || (r.status === "present" ? "in_school" : "absent"),
          note: r.note || null,
        })),
        summary,
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      }
    );

    res.status(201).json({
      message: "Attendance saved successfully.",
      attendance: {
        _id: attendance._id,
        date: attendance.date,
        group_id: attendance.group_id,
        subject_id: attendance.subject_id,
        summary: attendance.summary,
        recordsCount: attendance.records.length,
      },
    });
     console.log("Group attendance saved:", {
      attendanceId: attendance._id,
      group_id,
      subject_id,
      date: attendanceDate,
      recordsCount: attendance.records.length,
    });
  } catch (error) {
    console.error("saveAttendance error:", error);
    next(error);
  }
};

module.exports = {
  getAllTeacherSubjects,
  createTeacherSubject,
  deleteTeacherSubject,
  getTeacherDashboard,
  getGroupStudents,
  saveAttendance,
};
