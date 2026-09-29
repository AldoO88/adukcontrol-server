// Controlador de Credenciales
// Genera PDFs de credenciales de alumnos. Cuatro fuentes de diseño, en orden
// de prioridad:
//   1. template PDF CR80 (School.credentialTemplate.pdf + sides)
//      → services/credential-pdf.service (pdf-lib, composición directa)
//   2. layout visual legacy (School.credentialTemplate.layout)
//      → services/credential-layout.service
//   3. HTML personalizado (School.credentialTemplate.html) con Handlebars
//   4. templates/credentials/front.hbs + back.hbs (por defecto)
// Las fuentes 2–4 se convierten a PDF con puppeteer-core (Chrome del sistema).
//
// GET /api/students/credentials?school_year_id=...&school=...&ids=a,b,c

const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer-core");
const mongoose = require("mongoose");
const Student = require("../models/Student.model");
const School = require("../models/School.model");
const SchoolYear = require("../models/SchoolYear.model");
const Enrollment = require("../models/Enrollment.model");
const {
  layoutHasContent,
  renderLayoutPage,
  buildTemplateData,
} = require("../services/credential-layout.service");
const {
  credentialTemplateHasContent,
} = require("../services/credential-template.service");
const {
  composeCredentialsPdf,
} = require("../services/credential-pdf.service");

// ── Handlebars helpers ──────────────────────────────────────────────
Handlebars.registerHelper("formatGrade", function (grade, section) {
  return `${grade}° ${section || ""}`.trim();
});

Handlebars.registerHelper("formatShift", function (shift) {
  const map = { matutino: "Matutino", vespertino: "Vespertino" };
  return map[shift] || shift || "";
});

Handlebars.registerHelper("uppercase", function (str) {
  return (str || "").toUpperCase();
});

Handlebars.registerHelper("@index_plus_one", function () {
  return this["@index"] !== undefined ? this["@index"] + 1 : "";
});

// ── Chrome path detection ───────────────────────────────────────────
function findChromePath() {
  const candidates = [
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    // Windows
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let _chromePath = null;
function getChromePath() {
  if (!_chromePath) {
    _chromePath = findChromePath();
    if (!_chromePath) {
      throw new Error(
        "Chrome not found. Install Google Chrome or set CHROME_PATH env var."
      );
    }
  }
  return _chromePath;
}

// ── Load templates from disk (cached) ───────────────────────────────
let _frontTemplate = null;
let _backTemplate = null;

function getTemplates() {
  if (!_frontTemplate) {
    const dir = path.join(__dirname, "..", "templates", "credentials");
    const frontRaw = fs.readFileSync(path.join(dir, "front.hbs"), "utf8");
    const backRaw = fs.readFileSync(path.join(dir, "back.hbs"), "utf8");
    _frontTemplate = Handlebars.compile(frontRaw);
    _backTemplate = Handlebars.compile(backRaw);
  }
  return { front: _frontTemplate, back: _backTemplate };
}

// ── Custom template uploaded by the school (cached per updatedAt) ───
// Si la escuela subió un diseño HTML (School.credentialTemplate.html)
// se usa ese como template; cada alumno renderiza UNA sola página, por lo
// que el HTML custom debe traer su propio salto de página entre frente y
// reverso (style="page-break-after: always" en la primera cara).
// Si está vacío, se hace fallback a templates/credentials/front.hbs + back.hbs.
const _customTemplates = new Map(); // key: `${schoolId}:${updatedAtMs}`

function getCustomTemplate(schoolDoc) {
  const html = schoolDoc.credentialTemplate?.html;
  if (typeof html !== "string" || !html.trim()) return null;

  const updatedAtMs = schoolDoc.credentialTemplate.updatedAt
    ? new Date(schoolDoc.credentialTemplate.updatedAt).getTime()
    : 0;
  const key = `${schoolDoc._id}:${updatedAtMs}`;

  let compiled = _customTemplates.get(key);
  if (!compiled) {
    compiled = Handlebars.compile(html);
    // Invalida la entrada anterior de esta escuela (solo se cachea 1 por escuela).
    for (const k of _customTemplates.keys()) {
      if (k.startsWith(`${schoolDoc._id}:`)) _customTemplates.delete(k);
    }
    _customTemplates.set(key, compiled);
  }
  return compiled;
}

// ── Build template data ─────────────────────────────────────────────
// (buildTemplateData vive en services/credential-layout.service.js y se
// comparte con la impresión PDF CR80.)

// ── GET /api/students/credentials ───────────────────────────────────
const generateCredentialsPdf = async (req, res, next) => {
  let browser = null;
  try {
    const { school_year_id, ids } = req.query;

    if (!school_year_id || !mongoose.Types.ObjectId.isValid(school_year_id)) {
      return res
        .status(400)
        .json({ message: "Valid school_year_id is required." });
    }

    const isSuperAdmin = req.payload.role === "super_admin";
    const school = isSuperAdmin ? req.query.school : req.payload.schoolId;
    if (!school) {
      return res
        .status(400)
        .json({ message: "school is required (super_admin must pass it)." });
    }
    const schoolId = typeof school === "string" ? school : school.toString();

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

    const filter = { school: schoolId, status: "active" };
    if (ids) {
      const idList = String(ids)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => mongoose.Types.ObjectId.isValid(s));
      if (idList.length === 0) {
        return res.status(400).json({ message: "No valid ids provided." });
      }
      filter._id = { $in: idList };
    } else {
      // Sin ids → los alumnos inscritos ("enrolled") en EL CICLO, mismos
      // criterios que lista la página de credenciales (bajas del ciclo
      // quedan fuera).
      const enrolledIds = await Enrollment.distinct("student_id", {
        school: schoolId,
        school_year_id,
        cycle_status: "enrolled",
      });
      filter._id = { $in: enrolledIds };
    }

    const students = await Student.find(filter)
      .select(
        "controlNumber first_name last_name photoUrl current_group_id blood_type sex guardians"
      )
      .populate("current_group_id", "grade section shift")
      .populate("guardians", "name lastname relationship phone")
      .sort({ last_name: 1, first_name: 1 })
      .lean();

    if (students.length === 0) {
      return res.status(404).json({ message: "No students match criteria." });
    }

    // Cadena de diseño (1): template PDF CR80 — composición directa con
    // pdf-lib, sin navegador. Escala el fondo "contain" al marco CR80 y
    // estampa foto/textos en las coordenadas guardadas por alumno.
    const tpl = schoolDoc.credentialTemplate;
    if (credentialTemplateHasContent({ pdf: tpl?.pdf, sides: tpl?.sides })) {
      const cr80Buffer = await composeCredentialsPdf({
        pdfMeta: tpl.pdf,
        sides: tpl.sides,
        students,
        school: schoolDoc,
        schoolYear: schoolYearDoc,
      });
      const cr80Filename = `credenciales-${schoolDoc.cct}-${schoolYearDoc.name}.pdf`.replace(
        /[^a-zA-Z0-9.-]/g,
        "_"
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${cr80Filename}"`
      );
      return res.send(Buffer.from(cr80Buffer));
    }

    // Cadena de diseño (legacy): layout visual → HTML personalizado →
    // templates front.hbs/back.hbs de disco (render con Puppeteer).
    const layout = schoolDoc.credentialTemplate?.layout;
    const useLayout = layoutHasContent(layout);
    const customTemplate = useLayout ? null : getCustomTemplate(schoolDoc);
    const diskTemplates = useLayout || customTemplate ? null : getTemplates();

    const pages = [];
    for (const student of students) {
      const data = buildTemplateData({
        student,
        group: student.current_group_id,
        school: schoolDoc,
        schoolYear: schoolYearDoc,
      });
      if (useLayout) {
        pages.push(
          renderLayoutPage(layout.front?.background, layout.front?.elements, data)
        );
        const backPage = layout.back;
        const hasBack =
          backPage &&
          ((backPage.elements && backPage.elements.length > 0) ||
            (backPage.background && backPage.background.type !== "none"));
        if (hasBack) {
          pages.push(
            renderLayoutPage(backPage.background, backPage.elements, data)
          );
        }
      } else if (customTemplate) {
        pages.push(customTemplate(data));
      } else {
        pages.push(diskTemplates.front(data), diskTemplates.back(data));
      }
    }

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page { size: Letter; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; }
  .page-break { page-break-after: always; }
  .page-break:last-child { page-break-after: auto; }
  .cred-page { position: relative; width: 816px; height: 1056px; overflow: hidden; background: #fff; }
</style>
</head>
<body>
${pages.map((p) => `<div class="page-break">${p}</div>`).join("\n")}
</body>
</html>`;

    const chromePath =
      process.env.CHROME_PATH || getChromePath();

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    await browser.close();
    browser = null;

    const filename = `credenciales-${schoolDoc.cct}-${schoolYearDoc.name}.pdf`.replace(
      /[^a-zA-Z0-9.-]/g,
      "_"
    );
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.send(Buffer.from(pdfBuffer));
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    next(error);
  }
};

module.exports = { generateCredentialsPdf };
