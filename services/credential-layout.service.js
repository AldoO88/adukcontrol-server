// Servicio del diseñador visual de credenciales.
// - sanitizeLayout(raw): valida y normaliza el JSON que guarda la escuela en
//   School.credentialTemplate.layout (whitelist de campos/estilos).
// - renderLayoutPage(background, elements, data): convierte el layout de una
//   cara en HTML absolutely-positioned sobre un lienzo 816x1056 px
//   (Letter @96dpi), listo para que Chrome lo imprima a PDF.
//
// Estructura del layout:
//   {
//     version: 1,
//     front: { background: { type: "image"|"css"|"none", url?, css? }, elements: [...] },
//     back:  { background: {...}, elements: [...] },
//   }
// Element:
//   { id, kind: "text"|"image"|"shape", field, text, src, shape, x, y, w, h, style }

const CANVAS_WIDTH = 816;
const CANVAS_HEIGHT = 1056;
const MAX_ELEMENTS_PER_SIDE = 120;

// ── Campos mapeables (el mismo set que consume render) ──────────────
const TEXT_FIELDS = [
  "student.first_name",
  "student.last_name",
  "student.full_name",
  "student.controlNumber",
  "student.blood_type",
  "student.sex",
  "group.grade",
  "group.section",
  "group.grade_section",
  "group.shift",
  "school.name",
  "school.honoraryName",
  "school.cct",
  "school.address",
  "school.phoneNumber",
  "school.directorName",
  "school.city",
  "school.values",
  "school.indications",
  "guardian.phone",
  "schoolYear.name",
];

const IMAGE_FIELDS = [
  "student.photo",
  "school.logoUrl",
  "school.dgetLogoUrl",
  "school.iheLogoUrl",
  "school.watermarkUrl",
];

const TEXT_FIELD_SET = new Set(TEXT_FIELDS);
const IMAGE_FIELD_SET = new Set(IMAGE_FIELDS);

// ── Helpers de sanitización ─────────────────────────────────────────
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function str(value, maxLength, fallback = "") {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function isSafeColor(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  return /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,%\s]{1,40}\)|hsla?\([0-9.,%\sdeg]{1,40}\)|[a-zA-Z]{3,20})$/.test(
    value
  );
}

const ENUMS = {
  fontWeight: new Set([100, 200, 300, 400, 500, 600, 700, 800, 900, "bold", "normal"]),
  fontStyle: new Set(["normal", "italic"]),
  textAlign: new Set(["left", "center", "right", "justify"]),
  textTransform: new Set(["none", "uppercase", "lowercase", "capitalize"]),
  textDecoration: new Set(["none", "underline", "line-through"]),
  objectFit: new Set(["cover", "contain", "fill", "none"]),
};

function sanitizeStyle(raw) {
  if (!raw || typeof raw !== "object") return {};
  const s = {};

  if (Number.isFinite(Number(raw.fontSize))) s.fontSize = clampNum(raw.fontSize, 4, 300, 16);
  if (isSafeColor(raw.color)) s.color = raw.color;
  if (isSafeColor(raw.backgroundColor)) s.backgroundColor = raw.backgroundColor;
  if (
    typeof raw.fontWeight === "number" || typeof raw.fontWeight === "string"
  ) {
    const fw = typeof raw.fontWeight === "string" ? raw.fontWeight : Number(raw.fontWeight);
    if (ENUMS.fontWeight.has(fw)) s.fontWeight = fw;
  }
  if (ENUMS.fontStyle.has(raw.fontStyle)) s.fontStyle = raw.fontStyle;
  if (ENUMS.textAlign.has(raw.textAlign)) s.textAlign = raw.textAlign;
  if (ENUMS.textTransform.has(raw.textTransform)) s.textTransform = raw.textTransform;
  if (ENUMS.textDecoration.has(raw.textDecoration)) s.textDecoration = raw.textDecoration;
  if (Number.isFinite(Number(raw.lineHeight))) s.lineHeight = clampNum(raw.lineHeight, 0.5, 4, 1.3);
  if (Number.isFinite(Number(raw.letterSpacing))) s.letterSpacing = clampNum(raw.letterSpacing, -5, 30, 0);
  if (Number.isFinite(Number(raw.padding))) s.padding = clampNum(raw.padding, 0, 64, 0);
  if (Number.isFinite(Number(raw.borderRadius))) s.borderRadius = clampNum(raw.borderRadius, 0, 600, 0);
  if (Number.isFinite(Number(raw.opacity))) s.opacity = clampNum(raw.opacity, 0, 1, 1);
  if (ENUMS.objectFit.has(raw.objectFit)) s.objectFit = raw.objectFit;
  if (typeof raw.text === "string") s.text = raw.text.slice(0, 300); // placeholder en editor

  return s;
}

function sanitizeElement(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = ["text", "image", "shape"].includes(raw.kind) ? raw.kind : null;
  if (!kind) return null;

  const el = {
    id: str(raw.id, 64, "") || `el_${Math.random().toString(36).slice(2, 10)}`,
    kind,
    x: clampNum(raw.x, 0, CANVAS_WIDTH, 0),
    y: clampNum(raw.y, 0, CANVAS_HEIGHT, 0),
    w: clampNum(raw.w, 4, CANVAS_WIDTH, 100),
    h: clampNum(raw.h, 4, CANVAS_HEIGHT, 40),
    style: sanitizeStyle(raw.style),
  };

  if (kind === "text") {
    el.field = typeof raw.field === "string" && TEXT_FIELD_SET.has(raw.field) ? raw.field : null;
    el.text = str(raw.text, 300);
  } else if (kind === "image") {
    el.field = typeof raw.field === "string" && IMAGE_FIELD_SET.has(raw.field) ? raw.field : null;
    el.src = str(raw.src, 2048);
    el.text = str(raw.text, 120);
  } else {
    el.shape = raw.shape === "ellipse" ? "ellipse" : "rect";
  }

  return el;
}

function sanitizeBackground(raw) {
  if (!raw || typeof raw !== "object") return { type: "none" };
  const type = ["image", "css", "none"].includes(raw.type) ? raw.type : "none";

  if (type === "image") {
    const url = str(raw.url, 2048);
    if (!/^https?:\/\//.test(url)) return { type: "none" };
    return { type: "image", url };
  }

  if (type === "css") {
    const css = str(raw.css, 4000);
    // El CSS lo genera la UI (colores/gradientes/diagonales). Bloqueamos
    // cualquier constructo que pueda traer recursos externos o scripts.
    const forbidden = /url\s*\(|@import|expression\s*\(|javascript:|<|>/i;
    if (!css || forbidden.test(css)) return { type: "none" };
    return { type: "css", css };
  }

  return { type: "none" };
}

function sanitizePage(raw) {
  const page = raw && typeof raw === "object" ? raw : {};
  const rawElements = Array.isArray(page.elements) ? page.elements : [];
  const elements = rawElements.slice(0, MAX_ELEMENTS_PER_SIDE).map(sanitizeElement).filter(Boolean);
  return { background: sanitizeBackground(page.background), elements };
}

// Devuelve el layout limpio o null si el payload es inválido.
// `null` como input también devuelve null (limpiar diseño).
function sanitizeLayout(raw) {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return null;
  if (raw.version !== undefined && raw.version !== 1) return null;

  return {
    version: 1,
    front: sanitizePage(raw.front),
    back: sanitizePage(raw.back),
  };
}

// ¿El layout tiene contenido visible? (si no, el generador hace fallback)
function layoutHasContent(layout) {
  if (!layout) return false;
  const has = (page) =>
    page &&
    ((Array.isArray(page.elements) && page.elements.length > 0) ||
      (page.background && page.background.type !== "none"));
  return has(layout.front) || has(layout.back);
}

// ── Render ──────────────────────────────────────────────────────────
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function formatShift(shift) {
  const map = { matutino: "Matutino", vespertino: "Vespertino" };
  return map[shift] || shift || "";
}

function resolveField(field, data) {
  switch (field) {
    case "student.first_name": return data.student.first_name || "";
    case "student.last_name": return data.student.last_name || "";
    case "student.full_name":
      // Apellidos primero, luego nombres (convención usual en credenciales
      // escolares): "LOPEZ GUADARRAMA FRANCISCO DE JESUS".
      return `${data.student.last_name || ""} ${data.student.first_name || ""}`.trim();
    case "student.controlNumber": return data.student.controlNumber || "";
    case "student.blood_type": return data.student.blood_type || "";
    case "student.sex": return data.student.sex || "";
    case "group.grade": return data.group.grade !== "" && data.group.grade != null ? `${data.group.grade}°` : "";
    case "group.section": return data.group.section || "";
    case "group.grade_section":
      return data.group.grade !== "" && data.group.grade != null
        ? `${data.group.grade}° ${data.group.section || ""}`.trim()
        : "";
    case "group.shift": return formatShift(data.group.shift);
    case "school.name": return data.school.name || "";
    case "school.honoraryName": return data.school.honoraryName || "";
    case "school.cct": return data.school.cct || "";
    case "school.address": return data.school.address || "";
    case "school.phoneNumber": return data.school.phoneNumber || "";
    case "school.directorName": return data.school.directorName || "";
    case "school.city": return data.school.city || "";
    case "school.values": return data.school.values || "";
    case "school.indications": return Array.isArray(data.school.indications) ? data.school.indications : [];
    case "guardian.phone": return data.guardian?.phone || "";
    case "schoolYear.name": return data.schoolYear.name || "";
    default: return "";
  }
}

function styleToString(style, keys) {
  const map = {
    fontSize: (v) => `font-size:${v}px`,
    color: (v) => `color:${v}`,
    backgroundColor: (v) => `background-color:${v}`,
    fontWeight: (v) => `font-weight:${v}`,
    fontStyle: (v) => `font-style:${v}`,
    textAlign: (v) => `text-align:${v}`,
    textTransform: (v) => `text-transform:${v}`,
    textDecoration: (v) => `text-decoration:${v}`,
    lineHeight: (v) => `line-height:${v}`,
    letterSpacing: (v) => `letter-spacing:${v}px`,
    padding: (v) => `padding:${v}px`,
    opacity: (v) => `opacity:${v}`,
  };
  const s = style || {};
  return keys
    .filter((k) => s[k] !== undefined && map[k])
    .map((k) => map[k](s[k]))
    .join(";");
}

function renderElement(el, data) {
  const box = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`;
  const st = el.style || {};

  if (el.kind === "shape") {
    const radius = el.shape === "ellipse" ? "50%" : `${st.borderRadius || 0}px`;
    const color = isSafeColor(st.backgroundColor) ? st.backgroundColor : "#94a3b8";
    const opacity = st.opacity !== undefined ? `opacity:${st.opacity};` : "";
    return `<div style="${box}background:${color};border-radius:${radius};${opacity}"></div>`;
  }

  if (el.kind === "image") {
    const src = el.field ? resolveField(el.field, data) : el.src;
    if (!src) {
      // Sin foto → placeholder visible; logos sin URL → no se dibujan.
      if (el.field === "student.photo") {
        return `<div style="${box}background:#e2e8f0;border:1px dashed #94a3b8;display:flex;align-items:center;justify-content:center;font-size:11px;color:#64748b;">Sin foto</div>`;
      }
      return "";
    }
    const fit = st.objectFit || "contain";
    const radius = st.borderRadius ? `border-radius:${st.borderRadius}px;` : "";
    const opacity = st.opacity !== undefined ? `opacity:${st.opacity};` : "";
    return `<img src="${escapeHtml(src)}" style="${box}object-fit:${fit};${radius}${opacity}" alt=""/>`;
  }

  // kind === "text"
  let content;
  if (el.field === "school.indications") {
    const list = resolveField(el.field, data);
    content = Array.isArray(list)
      ? list.map((t, i) => `${i + 1}. ${t}`).join("<br/>")
      : "";
  } else {
    const value = el.field ? resolveField(el.field, data) : el.text || "";
    content = escapeHtml(value).replace(/\n/g, "<br/>");
  }

  const typography = styleToString(st, [
    "fontSize",
    "color",
    "fontWeight",
    "fontStyle",
    "textAlign",
    "textTransform",
    "textDecoration",
    "lineHeight",
    "letterSpacing",
    "padding",
    "opacity",
  ]);
  const bg = st.backgroundColor ? `background-color:${st.backgroundColor};` : "";
  const base = "font-family:'Helvetica Neue',Arial,sans-serif;overflow:hidden;word-break:break-word;";
  return `<div style="${box}${base}${bg}${typography}">${content}</div>`;
}

function renderBackground(background) {
  const bg = background || { type: "none" };
  if (bg.type === "image" && bg.url) {
    return `<img src="${escapeHtml(bg.url)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" alt=""/>`;
  }
  if (bg.type === "css" && bg.css) {
    return `<div style="position:absolute;inset:0;${escapeHtml(bg.css)}"></div>`;
  }
  return `<div style="position:absolute;inset:0;background:#ffffff;"></div>`;
}

// Devuelve una página completa (<div class="cred-page">…) con fondo + elementos.
function renderLayoutPage(background, elements, data) {
  const body = (elements || []).map((el) => renderElement(el, data)).join("");
  return `<div class="cred-page">${renderBackground(background)}${body}</div>`;
}

// ── Datos del template (compartido por render HTML legacy e impresión) ──
const DEFAULT_INDICATIONS = [
  "La entrada a la escuela es 7:10 am. La puerta se cierra a las 7:25 am.",
  "Traer uniforme completo, limpio y correspondiente.",
  "Portar esta credencial en todo momento durante el horario escolar y visible.",
  "Traer utiles y materiales necesarios de acuerdo al horario, prohibido recibir materiales y objetos durante la jornada escolar.",
  "Ayudanos a mantener la escuela limpia, con un ambiente sano y pacifico.",
  "Prohibido utilizar el celular dentro del plantel sin autorizacion del personal.",
];

function buildTemplateData({ student, group, school, schoolYear }) {
  const credConfig = school.credentialConfig || {};
  // `Student.guardians` puede contener refs pobladas o solo ObjectIds;
  // nos quedamos con el primero (tutor principal por convención del
  // sistema). Si no hay ninguno, los campos de `guardian` quedan vacíos
  // y resolveField devuelve "".
  const guardianRaw = Array.isArray(student.guardians) ? student.guardians[0] : null;
  const guardian = guardianRaw && typeof guardianRaw === "object"
    ? {
        name: guardianRaw.name || "",
        relationship: guardianRaw.relationship || "",
        phone: guardianRaw.phone || "",
      }
    : { name: "", relationship: "", phone: "" };
  return {
    student: {
      first_name: student.first_name || "",
      last_name: student.last_name || "",
      controlNumber: student.controlNumber || "",
      photoUrl: student.photoUrl || "",
      blood_type: student.blood_type || "",
      sex: student.sex || "",
    },
    group: {
      grade: group?.grade || "",
      section: group?.section || "",
      shift: group?.shift || "",
    },
    school: {
      name: school.name || "",
      honoraryName: school.honoraryName || "",
      cct: school.cct || "",
      logoUrl: school.logoUrl || "",
      address: school.address || "",
      phoneNumber: school.phoneNumber || "",
      dgetLogoUrl: credConfig.dgetLogoUrl || "",
      iheLogoUrl: credConfig.iheLogoUrl || "",
      watermarkUrl: credConfig.watermarkUrl || "",
      directorName: credConfig.directorName || "",
      values: credConfig.values || "DISCIPLINA ● RESPETO ● EXCELENCIA",
      city: credConfig.city || "",
      indications: credConfig.indications?.length
        ? credConfig.indications
        : DEFAULT_INDICATIONS,
    },
    schoolYear: {
      name: schoolYear.name || "",
    },
    guardian,
  };
}

module.exports = {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  TEXT_FIELDS,
  IMAGE_FIELDS,
  TEXT_FIELD_SET,
  sanitizeStyle,
  resolveField,
  buildTemplateData,
  sanitizeLayout,
  layoutHasContent,
  renderLayoutPage,
  escapeHtml,
};
