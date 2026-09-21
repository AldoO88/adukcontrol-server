// Controlador de Credenciales
// Genera PDFs de credenciales de alumnos (estilo "credencial escolar").
// GET /api/students/credentials?school_year_id=...&ids=a,b,c
//   - Sin "ids": genera credencial para TODOS los alumnos activos del ciclo.
//   - Con "ids" (csv): genera solo para esos alumnos.
//   - Devuelve application/pdf stream.
//
// Diseño de la credencial (formato card 85.6mm × 54mm — tamaño ID-1):
//   Lado A: logo de la escuela, foto del alumno, nombre, no. control, grado/grupo
//   Lado B: dirección de la escuela, ciclo escolar, año, código QR
//   QR contiene: controlNumber|name|school|year (validable offline)

const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const Student = require("../models/Student.model");
const School = require("../models/School.model");
const SchoolYear = require("../models/SchoolYear.model");
const Group = require("../models/Group.model");

const tenantFilter = (req) =>
  req.payload.role === "super_admin" ? {} : { school: req.payload.schoolId };

// Genera el PDF en chunks via async generator.
async function* buildCredentialPdf({ school, schoolYear, students }) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 30, bottom: 30, left: 30, right: 30 },
    autoFirstPage: true,
    info: {
      Title: `Credenciales ${school.name} - ${schoolYear.name}`,
      Author: school.name,
      Subject: "Credenciales escolares",
    },
  });

  // Buffer collection
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const endPromise = new Promise((resolve) => {
    doc.on("end", () => resolve());
  });

  // Genera QR codes en paralelo (QRCode.toBuffer es async)
  const qrCodes = await Promise.all(
    students.map((s) => {
      const payload = JSON.stringify({
        controlNumber: s.controlNumber,
        name: `${s.first_name} ${s.last_name || ""}`.trim(),
        school: school.name,
        cycle: schoolYear.name,
      });
      return QRCode.toBuffer(payload, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 200,
      });
    })
  );

  // Layout: 1 credencial por página A4 (centrada). Tarjeta ID-1 = 85.6×54mm.
  // 85.6mm = 242.6 pt (1 mm = 2.835 pt); 54mm = 153 pt.
  const cardW = 242.6;
  const cardH = 153;
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 30;

  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    if (i > 0) doc.addPage();

    const cardX = (pageW - cardW) / 2;
    const cardY = (pageH - cardH) / 2;
    const qr = qrCodes[i];

    // Header: nombre de la escuela (en negrita)
    doc
      .fillColor("#0f172a")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(school.name.toUpperCase(), cardX, cardY + 8, {
        width: cardW,
        align: "center",
      });

    // Subtítulo: nombre honorífico
    if (school.honoraryName) {
      doc
        .fontSize(7)
        .font("Helvetica-Oblique")
        .fillColor("#475569")
        .text(school.honoraryName, cardX, cardY + 22, {
          width: cardW,
          align: "center",
        });
    }

    // Avatar circle (placeholder con iniciales si no hay foto)
    const avatarR = 22;
    const avatarX = cardX + cardW / 2 - avatarR;
    const avatarY = cardY + 38;
    if (s.photoUrl) {
      try {
        doc.image(s.photoUrl, avatarX, avatarY, {
          fit: [avatarR * 2, avatarR * 2],
          align: "center",
          valign: "center",
        });
      } catch {
        drawInitialsCircle(doc, s, avatarX, avatarY, avatarR);
      }
    } else {
      drawInitialsCircle(doc, s, avatarX, avatarY, avatarR);
    }

    // Nombre
    doc
      .fillColor("#0f172a")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text(
        `${s.first_name || ""} ${s.last_name || ""}`.trim() || "—",
        cardX,
        cardY + 88,
        { width: cardW, align: "center" }
      );

    // Número de control + grado/grupo
    const groupLabel = s.current_group_id
      ? `${s.current_group_id.grade}°${s.current_group_id.section}`
      : "—";
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#475569")
      .text(
        `No. Control: ${s.controlNumber || "—"}   ·   Grado: ${groupLabel}`,
        cardX,
        cardY + 104,
        { width: cardW, align: "center" }
      );

    // Footer: ciclo escolar
    doc
      .fontSize(7)
      .font("Helvetica")
      .fillColor("#64748b")
      .text(`Ciclo Escolar ${schoolYear.name}`, cardX, cardY + 122, {
        width: cardW,
        align: "center",
      });

    // QR en esquina inferior derecha
    const qrSize = 36;
    doc.image(qr, cardX + cardW - qrSize - 8, cardY + cardH - qrSize - 8, {
      width: qrSize,
      height: qrSize,
    });

    // Borde de la tarjeta
    doc
      .lineWidth(1)
      .strokeColor("#cbd5e1")
      .roundedRect(cardX, cardY, cardW, cardH, 6)
      .stroke();
  }

  doc.end();
  await endPromise;
  yield* chunks;
}

function drawInitialsCircle(doc, student, x, y, r) {
  const initials = `${(student.first_name || "?").charAt(0)}${
    (student.last_name || "").charAt(0) || ""
  }`.toUpperCase();
  doc
    .save()
    .fillColor("#e0f2fe")
    .circle(x + r, y + r, r)
    .fill();
  doc
    .fillColor("#0369a1")
    .fontSize(14)
    .font("Helvetica-Bold")
    .text(initials, x, y + r - 7, { width: r * 2, align: "center" })
    .restore();
}

// GET /api/students/credentials
// Query params:
//   school_year_id — required
//   ids            — optional csv (lista de student._id a incluir)
// Auth: admin/registrar/super_admin.
const generateCredentialsPdf = async (req, res, next) => {
  try {
    const { school_year_id, ids } = req.query;

    if (
      !school_year_id ||
      !mongoose.Types.ObjectId.isValid(school_year_id)
    ) {
      return res.status(400).json({ message: "Valid school_year_id is required." });
    }

    const isSuperAdmin = req.payload.role === "super_admin";
    const school = isSuperAdmin
      ? req.query.school
      : req.payload.schoolId;
    if (!school) {
      return res
        .status(400)
        .json({ message: "school is required (super_admin must pass it)." });
    }
    const schoolId =
      typeof school === "string" ? school : school.toString();

    // Verificar escuela
    const schoolDoc = await School.findById(schoolId).lean();
    if (!schoolDoc) {
      return res.status(404).json({ message: "School not found." });
    }

    const schoolYearDoc = await SchoolYear.findOne({
      _id: school_year_id,
      school: schoolId,
    }).lean();
    if (!schoolYearDoc) {
      return res
        .status(404)
        .json({ message: "School year not found for this school." });
    }

    // Cargar alumnos
    const filter = {
      school: schoolId,
      status: "active",
    };
    if (ids) {
      const idList = String(ids)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => mongoose.Types.ObjectId.isValid(s));
      if (idList.length === 0) {
        return res.status(400).json({ message: "No valid ids provided." });
      }
      filter._id = { $in: idList };
    }

    const students = await Student.find(filter)
      .select("controlNumber first_name last_name photoUrl current_group_id")
      .populate("current_group_id", "grade section")
      .sort({ last_name: 1, first_name: 1 })
      .lean();

    if (students.length === 0) {
      return res.status(404).json({ message: "No students match criteria." });
    }

    // Set response headers
    const filename = `credenciales-${schoolDoc.cct}-${schoolYearDoc.name}.pdf`
      .replace(/[^a-zA-Z0-9.-]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    // Stream el PDF
    for await (const chunk of buildCredentialPdf({
      school: schoolDoc,
      schoolYear: schoolYearDoc,
      students,
    })) {
      res.write(chunk);
    }
    res.end();
  } catch (error) {
    next(error);
  }
};

const mongoose = require("mongoose");

module.exports = {
  generateCredentialsPdf,
};
