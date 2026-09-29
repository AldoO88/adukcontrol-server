// Servicio del template de credenciales "CR80" (diseñador solo-PDF).
//
// Modelo de datos:
//   - El fondo es el PDF ORIGINAL que sube la escuela desde Canva/Illustrator
//     (bytes intactos en Cloudinary, resource_type "raw").
//   - Los elementos dinámicos (foto, textos) se guardan en PUNTOS PDF dentro
//     de un marco fijo de tarjeta PVC CR80 (85.6 × 54 mm), origen arriba-
//     izquierda. Al imprimir, el PDF de fondo se dibuja dentro del marco con
//     escala uniforme "contain" (sin recortar) y los elementos se estampan en
//     sus coordenadas — misma transformación que aplica el editor web en la
//     vista previa, para que preview e impresión coincidan.
//
// Coordenadas: el editor usa origen arriba-izquierda; en el espacio PDF
// (origen abajo-izquierda) la conversión es: y_pdf = CR80_HEIGHT_PT - y - h.
const { TEXT_FIELDS, sanitizeStyle } = require("./credential-layout.service");

const CR80_WIDTH_PT = 242.64; // 85.6 mm
const CR80_HEIGHT_PT = 153.07; // 54 mm
const MAX_SIDES = 2; // frente / reverso
const MAX_PDF_PAGES = 2;
const MAX_ELEMENTS_PER_SIDE = 15;
const MAX_FONT_SIZE_PT = 96; // tope realista para una tarjeta CR80

const TEXT_FIELD_SET = new Set(TEXT_FIELDS);

// ── Helpers locales ─────────────────────────────────────────────────
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function str(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.slice(0, maxLength);
}

// ── Sanitizadores ───────────────────────────────────────────────────

// PDF de fondo. Solo acepta URLs de Cloudinary (el archivo ya fue subido
// por POST /assets; el PUT solo guarda la referencia).
function sanitizeTemplatePdf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = str(raw.url, 512);
  if (!/^https:\/\/res\.cloudinary\.com\//.test(url)) return null;

  const pages = Math.round(clampNum(raw.pages, 1, MAX_PDF_PAGES, 1));
  const widthPt = round2(clampNum(raw.widthPt, 1, 2000, CR80_WIDTH_PT));
  const heightPt = round2(clampNum(raw.heightPt, 1, 2000, CR80_HEIGHT_PT));
  const publicId = str(raw.public_id, 256);
  const assetId = str(raw.asset_id, 128);

  return {
    url,
    public_id: publicId || null,
    asset_id: assetId || null,
    pages,
    widthPt,
    heightPt,
  };
}

// Elemento dinámico sobre el marco CR80: "photo" (foto del alumno), "text"
// (campo mapeado o texto libre), "logo" (imagen de la escuela subida vía
// /credential-config/logos) y "shape" (línea/rect/elipse).
const SHAPE_KINDS = new Set(["line", "rect", "ellipse"]);

function sanitizeTemplateElement(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kindRaw = raw.kind;
  const kind =
    kindRaw === "photo" || kindRaw === "text" || kindRaw === "logo" ||
    kindRaw === "shape"
      ? kindRaw
      : null;
  if (!kind) return null;

  const style = sanitizeStyle(raw.style || {});
  if (Number.isFinite(style.fontSize)) {
    style.fontSize = clampNum(style.fontSize, 4, MAX_FONT_SIZE_PT, 16);
  }

  const defaultW =
    kind === "photo" ? 60 : kind === "logo" ? 30 : kind === "shape" ? 50 : 100;
  const defaultH =
    kind === "photo" ? 75 : kind === "logo" ? 30 : kind === "shape" ? 6 : 14;

  const el = {
    id: str(raw.id, 64, "") || `el_${Math.random().toString(36).slice(2, 10)}`,
    kind,
    x: clampNum(raw.x, 0, CR80_WIDTH_PT, 0),
    y: clampNum(raw.y, 0, CR80_HEIGHT_PT, 0),
    w: clampNum(raw.w, 4, CR80_WIDTH_PT, defaultW),
    h: clampNum(raw.h, 4, CR80_HEIGHT_PT, defaultH),
    style,
  };
  // Coordenadas en el marco: la caja no puede quedar totalmente fuera.
  el.x = clampNum(raw.x, 0, Math.max(0, CR80_WIDTH_PT - el.w), 0);
  el.y = clampNum(raw.y, 0, Math.max(0, CR80_HEIGHT_PT - el.h), 0);

  if (kind === "text") {
    el.field =
      typeof raw.field === "string" && TEXT_FIELD_SET.has(raw.field)
        ? raw.field
        : null;
    el.text = str(raw.text, 300); // texto libre (fallback si no hay field)
  } else if (kind === "logo") {
    // logoId referencia un asset en School.credentialConfig.logos[]; se
    // valida en compose (puede ser null mientras el usuario solo lo
    // está arrastrando al lienzo).
    el.logoId =
      typeof raw.logoId === "string" && raw.logoId.length <= 128
        ? raw.logoId
        : null;
  } else if (kind === "shape") {
    const sh = typeof raw.shape === "string" ? raw.shape.toLowerCase() : "";
    el.shape = SHAPE_KINDS.has(sh) ? sh : "rect";
  }

  return el;
}

// Lados del template: [{ elements: [...] }, ...] — uno por página del PDF.
function sanitizeSides(raw) {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_SIDES) return null;

  return raw.map((side) => {
    const page = side && typeof side === "object" ? side : {};
    const elements = Array.isArray(page.elements)
      ? page.elements.slice(0, MAX_ELEMENTS_PER_SIDE).map(sanitizeTemplateElement).filter(Boolean)
      : [];
    return { elements };
  });
}

// ¿El template PDF tiene contenido imprimible? (para la cadena de
// impresión: template PDF > HTML personalizado > hbs de disco).
function credentialTemplateHasContent({ pdf, sides } = {}) {
  if (!pdf || !pdf.url) return false;
  return (
    Array.isArray(sides) &&
    sides.some((side) => side && Array.isArray(side.elements) && side.elements.length > 0)
  );
}

// Escala "contain" compartida por editor e impresor: encoge/anima el PDF
// de origen para caber dentro del marco CR80 sin recortar, centrado.
function scaleToFit(srcWidth, srcHeight, boxWidth, boxHeight) {
  const scale = Math.min(boxWidth / srcWidth, boxHeight / srcHeight);
  return {
    scale,
    width: srcWidth * scale,
    height: srcHeight * scale,
    x: (boxWidth - srcWidth * scale) / 2,
    y: (boxHeight - srcHeight * scale) / 2,
  };
}

module.exports = {
  CR80_WIDTH_PT,
  CR80_HEIGHT_PT,
  MAX_SIDES,
  MAX_PDF_PAGES,
  MAX_ELEMENTS_PER_SIDE,
  sanitizeTemplatePdf,
  sanitizeTemplateElement,
  sanitizeSides,
  credentialTemplateHasContent,
  scaleToFit,
};
