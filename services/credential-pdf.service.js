// Servicio de composición de credenciales CR80 con pdf-lib.
//
// Flujo de impresión (sin navegador):
//   1. Descarga el PDF de fondo ORIGINAL de la escuela (Cloudinary raw, con
//      caché por URL) y lo carga una sola vez.
//   2. Determina la orientación de la página de salida desde la página 0
//      del fondo (vertical si view.h > view.w, si no horizontal). Todas las
//      páginas de salida comparten esa orientación para que el duplex del
//      ZC300 alinee las caras como una sola tarjeta.
//   3. Por alumno × página: crea una página CR80 orientada como el fondo,
//      dibuja el fondo con fitBackground (cover si cabe en el sangrado,
//      si no contain — mismo criterio que el editor web) y estampa los
//      elementos guardados transformados con un mapeo afín desde el marco
//      horizontal canónico (donde se almacenan) hasta el marco de salida
//      (donde se imprimen). Si la salida es horizontal y el fit del fondo
//      no cambia, el mapeo es identidad y no hay regresión.
//        - photo → foto del alumno en PNG (Cloudinary f_png) con cover;
//          placeholder gris si no hay foto.
//        - text  → campo mapeado o texto libre con Helvetica/HelveticaBold,
//          alineación, wrap de párrafos + auto-shrink (mismo algoritmo y
//          métricas que el diseñador → WYSIWYG).
//   4. Devuelve el Buffer PDF listo para enviar.
//
// Rendimiento: el fondo se cachea; las fotos únicas se pre-cargan en
// paralelo (pool) y cada estampado es operación de milisegundos.
const { PDFDocument, StandardFonts, rgb, PDFOperator, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = require("pdf-lib");
const pdfLib = require("pdf-lib"); // para clipToRect / clipEnd (sólo necesitan nombres)
require("../config/cloudinary");
const cloudinary = require("cloudinary").v2;
const cloudinaryUtils = require("cloudinary/lib/utils/index.js");
const {
  CR80_WIDTH_PT,
  CR80_HEIGHT_PT,
  fitBackground,
} = require("./credential-template.service");

// Escala la imagen para CUBRIR el destino (object-fit: cover): llena el
// cuadro recortando lo que sobre por la dimensión más larga.
// Devuelve { x, y, width, height } dentro de una caja [dstW × dstH].
function scaleToCover(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  let drawW;
  let drawH;
  if (srcRatio > dstRatio) {
    // La imagen es más ancha que el destino: cubre en alto, recorta lados.
    drawH = dstH;
    drawW = srcW * (dstH / srcH);
  } else {
    // La imagen es más alta o igual: cubre en ancho, recorta arriba/abajo.
    drawW = dstW;
    drawH = srcH * (dstW / srcW);
  }
  return {
    x: (dstW - drawW) / 2,
    y: (dstH - drawH) / 2,
    width: drawW,
    height: drawH,
  };
}

// Mapea un elemento guardado en el marco horizontal canónico al marco de
// salida (horizontal o vertical) usando el factor uniforme k = sNuevo/sViejo
// entre los fit del fondo. Conserva la posición relativa del elemento sobre
// el fondo: si la salida es horizontal con el mismo fit, k = 1 → identidad.
// Devuelve una COPIA con coords + fontSize escalados, clampada a la página.
function transformElement(el, fitOld, fitNew, frameW, frameH) {
  const oldScale = fitOld.scale || 0;
  const newScale = fitNew.scale || 0;
  if (oldScale <= 0 || newScale <= 0) {
    return { ...el };
  }
  const k = newScale / oldScale;
  const ox = fitOld.x || 0;
  const oy = fitOld.y || 0;
  const nx = fitNew.x || 0;
  const ny = fitNew.y || 0;
  const w = Math.max(4, (el.w || 0) * k);
  const h = Math.max(4, (el.h || 0) * k);
  const rawX = nx + ((el.x || 0) - ox) * k;
  const rawY = ny + ((el.y || 0) - oy) * k;
  const x = Math.min(Math.max(0, rawX), Math.max(0, frameW - w));
  const y = Math.min(Math.max(0, rawY), Math.max(0, frameH - h));
  const out = { ...el, x, y, w, h };
  if (el.style && Number.isFinite(el.style.fontSize)) {
    out.style = { ...el.style, fontSize: el.style.fontSize * k };
  }
  return out;
}
const {
  resolveField,
  buildTemplateData,
} = require("./credential-layout.service");
const { layoutCr80Text } = require("./credential-text-layout");

// ── Caché de fondos (public_id|url → bytes) ─────────────────────────
const FONDO_CACHE_TTL_MS = 10 * 60 * 1000;
const FONDO_CACHE_MAX = 8;
const fondoCache = new Map(); // key → { bytes: Buffer, at: number }

const FETCH_TIMEOUT_MS = 15000;

async function fetchBytes(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 80)}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// La entrega pública de PDFs está bloqueada en esta cuenta de Cloudinary
// (401 en delivery, incluso con firma o access_mode public), así que el
// original se baja con el endpoint admin /asset/download (Upload API),
// firmado con api_key + timestamp sobre el asset_id immutable.
async function downloadFromCloudinary(meta) {
  let assetId = meta.asset_id || null;
  if (!assetId) {
    const info = await cloudinary.api.resource(meta.public_id, {
      resource_type: "raw",
    });
    assetId = info.asset_id;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = cloudinaryUtils.sign_request({ asset_id: assetId, timestamp }, {});
  const qs = new URLSearchParams(signed).toString();
  const cloud = cloudinary.config().cloud_name;
  return fetchBytes(`https://api.cloudinary.com/v1_1/${cloud}/asset/download?${qs}`);
}

// meta: { url, public_id?, asset_id? } (School.credentialTemplate.pdf) o
// una URL string directa (tests locales / fondos no-Cloudinary).
async function fetchFondo(meta) {
  const key =
    typeof meta === "string" ? meta : meta.public_id || meta.url || "";
  const hit = fondoCache.get(key);
  if (hit && Date.now() - hit.at < FONDO_CACHE_TTL_MS) return hit.bytes;

  let bytes;
  if (typeof meta === "object" && meta && meta.public_id) {
    bytes = await downloadFromCloudinary(meta);
  } else {
    bytes = await fetchBytes(typeof meta === "string" ? meta : meta.url);
  }
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error("Background did not return a PDF.");
  }
  // LRU barato: si está lleno, borra la entrada más vieja.
  if (!fondoCache.has(key) && fondoCache.size >= FONDO_CACHE_MAX) {
    const oldest = fondoCache.keys().next().value;
    fondoCache.delete(oldest);
  }
  fondoCache.set(key, { bytes, at: Date.now() });
  return bytes;
}

// ── Fotos de alumnos ────────────────────────────────────────────────
// Las fotos se guardan en WebP; PDF admite PNG/JPEG. Si la URL es de
// Cloudinary se pide la conversión con f_png; si ya trae transformación
// se usa tal cual. Devuelve { bytes, kind: "png" | "jpg" } o null.
function toPngUrl(url) {
  if (!/^https?:\/\//.test(url)) return null;
  // Solo Cloudinary admite pedir la conversión con un prefijo de transformación.
  if (!url.includes("res.cloudinary.com")) return url;
  if (url.includes("/upload/f_") || url.includes("/upload/t_")) return url;
  return url.replace("/upload/", "/upload/f_png/");
}

async function fetchFoto(photoUrl) {
  const url = toPngUrl(photoUrl);
  if (!url) return null;
  try {
    const bytes = await fetchBytes(url, 10000);
    const head = bytes.subarray(0, 4);
    if (head[0] === 0x89 && head[1] === 0x50) return { bytes, kind: "png" };
    if (head[0] === 0xff && head[1] === 0xd8) return { bytes, kind: "jpg" };
    return null; // formato no soportado por PDF (p. ej. WebP sin convertir)
  } catch {
    return null;
  }
}

// Logo subido por el usuario. Los logos se sirven vía secure_url HTTPS
// pública (Cloudinary) — la cuenta entrega imágenes bien, distinto de los
// PDFs (que requieren admin /asset/download). Devuelve
// { bytes, kind: "png"|"jpg"|"svg" } o null si no se pudo obtener.
async function fetchLogoBytes(logo) {
  const url = logo && typeof logo.url === "string" ? logo.url : "";
  if (!url) return null;
  // Si el formato es SVG (vectorial), bajamos los bytes directo y los
  // embebemos con embedSvg en pdf-lib.
  if (logo.format === "svg" || /\.svg(\?|$)/i.test(url)) {
    try {
      const bytes = await fetchBytes(url, 10000);
      const head = bytes.subarray(0, 5).toString("utf8");
      if (head.includes("<svg") || head.includes("<?xml")) {
        return { bytes, kind: "svg" };
      }
    } catch {
      /* cae a png/jpg */
    }
  }
  // Imágenes raster → preferir PNG (pdf-lib nativo).
  const target = url.includes("/upload/") ? url.replace("/upload/", "/upload/f_png/") : url;
  try {
    const bytes = await fetchBytes(target, 10000);
    const head = bytes.subarray(0, 4);
    if (head[0] === 0x89 && head[1] === 0x50) return { bytes, kind: "png" };
    if (head[0] === 0xff && head[1] === 0xd8) return { bytes, kind: "jpg" };
    return null;
  } catch {
    return null;
  }
}

// ── Utilidades ──────────────────────────────────────────────────────
async function pool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(limit, Math.max(queue.length, 1)) },
    async () => {
      while (queue.length) {
        const item = queue.shift();
        await fn(item);
      }
    }
  );
  await Promise.all(workers);
}

function hexToColor(value, fallback = rgb(0, 0, 0)) {
  if (typeof value !== "string") return fallback;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return fallback;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

// ── Estampado de elementos ──────────────────────────────────────────
const ASCENDER_RATIO = 0.776; // línea: baseline ≈ topline + lineH * 0.776

function stampText(page, fonts, el, data, frameH) {
  const raw = el.field ? resolveField(el.field, data) : el.text || "";
  if (raw === "" || raw == null) return;
  const paragraphs = (Array.isArray(raw) ? raw : String(raw).split("\n"))
    .map((l) => String(l))
    .filter((l) => l.length > 0);
  if (paragraphs.length === 0) return;

  const st = el.style || {};
  const bold = st.fontWeight === "bold" || Number(st.fontWeight) >= 600;
  const font = bold ? fonts.bold : fonts.regular;
  const color = hexToColor(st.color);
  const yTop = frameH - el.y - el.h;

  // Mismo algoritmo que el diseñador (wrap voraz + auto-shrink + safety,
  // services/credential-text-layout.js ≡ web/src/lib/cr80-text-layout.ts):
  // { lines, size } es exactamente lo que el editor muestra.
  const { lines, size } = layoutCr80Text(
    paragraphs,
    el.w,
    el.h,
    st.fontSize || 16,
    (t, s) => font.widthOfTextAtSize(t, s)
  );
  if (lines.length === 0) return;

  const align = st.textAlign === "center" ? "center" : st.textAlign === "right" ? "right" : "left";
  const lineH = font.heightAtSize(size);
  const spacing = size * 1.2;
  // Centramos midiendo desde el borde SUPERIOR (mismo lado que el
  // editor). En yup: topEdge = frameH - el.y. La distancia de
  // la baseline al top del elemento es, igual que en el lienzo,
  //   blockTop + i*spacing + lineH*ASCENDER_RATIO
  // con blockTop = max(0, (h - n*spacing)/2). PDF usa y-up → restamos.
  const topYup = frameH - el.y;
  const blockTop = Math.max(0, (el.h - lines.length * spacing) / 2);
  lines.forEach((line, i) => {
    const textW = font.widthOfTextAtSize(line, size);
    let x = el.x;
    if (align === "center") x = el.x + Math.max(0, (el.w - textW) / 2);
    else if (align === "right") x = el.x + Math.max(0, el.w - textW);
    page.drawText(line, {
      x,
      y: topYup - blockTop - i * spacing - lineH * ASCENDER_RATIO,
      size,
      font,
      color,
    });
  });
}

// "cover" + clip-to-box: escalamos para que la imagen CUBRA la caja, y
// limitamos el dibujo a la caja exacta con un clip-path (pushGraphicsState
// → rectangle → clip → endPath; cerrado con popGraphicsState). Sin el
// clip, la foto se desborda al exterior del rectángulo que diseñaste
// (visible especialmente con fotos cuadradas en cajas portrait).
function clipToRect(page, x, y, w, h) {
  page.pushOperators(
    pdfLib.pushGraphicsState(),
    pdfLib.rectangle(x, y, w, h),
    pdfLib.clip(),
    pdfLib.endPath(),
  );
}
function clipEnd(page) {
  page.pushOperators(pdfLib.popGraphicsState());
}

async function stampPhoto(page, out, el, data, fotoCache, frameH) {
  const yTop = frameH - el.y - el.h;
  const photoUrl = data.student.photoUrl || "";
  const foto = photoUrl ? fotoCache.get(photoUrl) || null : null;

  if (!foto) {
    // Placeholder: ocupa exactamente la caja configurada, igual que
    // cualquier imagen renderizada (cover semantics).
    page.drawRectangle({
      x: el.x,
      y: yTop,
      width: el.w,
      height: el.h,
      color: rgb(0.886, 0.91, 0.94),
      borderColor: rgb(0.58, 0.64, 0.72),
      borderWidth: 0.5,
    });
    return;
  }

  let image = foto.image;
  if (!image) {
    image = foto.kind === "jpg" ? await out.embedJpg(foto.bytes) : await out.embedPng(foto.bytes);
    foto.image = image; // reutiliza el embedding en todas las páginas
  }

  // cover: la foto se escala para CUBRIR el área configurada. Si el
  // cuadro es rectangular, la imagen resultante rebasa los bordes por
  // uno o dos lados — el clip-to-box de abajo se encarga de esconder
  // ese excedente (sin recortar el dib. en el editor, sin desbordar en
  // el PDF).
  const fit = scaleToCover(image.width, image.height, el.w, el.h);
  clipToRect(page, el.x, yTop, el.w, el.h);
  page.drawImage(image, {
    x: el.x + fit.x,
    y: yTop + fit.y,
    width: fit.width,
    height: fit.height,
  });
  clipEnd(page);
}

// Logo de la escuela: imagen subida a Cloudinary desde
// /credential-config/logos; rendereada con la misma semántica "contain"
// que la foto del alumno, dentro de la caja del elemento.
async function stampLogo(page, out, el, logoCache, frameH) {
  const yTop = frameH - el.y - el.h;
  const logo = el.logoId ? logoCache.get(el.logoId) || null : null;

  const drawPlaceholder = () => {
    page.drawRectangle({
      x: el.x,
      y: yTop,
      width: el.w,
      height: el.h,
      color: rgb(0.952, 0.96, 0.98),
      borderColor: rgb(0.58, 0.64, 0.72),
      borderWidth: 0.5,
      borderDashArray: [2, 2],
    });
  };

  if (!logo) {
    drawPlaceholder();
    return;
  }

  let image = logo.image;
  if (!image) {
    try {
      if (logo.kind === "svg" && logo.bytes) {
        image = await out.embedSvg(logo.bytes);
      } else if (logo.kind === "jpg") {
        image = await out.embedJpg(logo.bytes);
      } else if (logo.bytes) {
        image = await out.embedPng(logo.bytes);
      }
    } catch {
      image = null;
    }
    if (!image) {
      drawPlaceholder();
      return;
    }
    logo.image = image;
  }

  // cover: el logo se escala para cubrir la caja (no se deforma: si la
  // caja es más alta que el logo, se recorta arriba/abajo). Clip a la
  // caja para que no desborde sobre el resto del arte.
  const fit = scaleToCover(image.width, image.height, el.w, el.h);
  clipToRect(page, el.x, yTop, el.w, el.h);
  page.drawImage(image, {
    x: el.x + fit.x,
    y: yTop + fit.y,
    width: fit.width,
    height: fit.height,
  });
  clipEnd(page);
}

// Figuras básicas: línea, rect, elipse. Comparten stroke / fill /
// strokeWidth desde el.style del elemento, idéntico al editor.
function stampShape(page, el, frameH) {
  const yTop = frameH - el.y - el.h;
  const st = el.style || {};
  const stroke = st.stroke ? hexToColor(st.stroke) : undefined;
  const fill = st.fill ? hexToColor(st.fill) : undefined;
  const thickness = Math.max(0.5, Number(st.strokeWidth) || 1);

  if (el.shape === "line") {
    // Línea horizontal centrada verticalmente en la caja — su longitud
    // sigue el ancho del elemento (la caja define la longitud).
    page.drawLine({
      start: { x: el.x, y: yTop + el.h / 2 },
      end: { x: el.x + el.w, y: yTop + el.h / 2 },
      thickness,
      color: stroke || rgb(0.15, 0.15, 0.15),
    });
    return;
  }

  if (el.shape === "ellipse") {
    // drawEllipse usa (x, y) = centro y (xScale, yScale) = radios
    // (semicomp eje X/Y); width/height son IGNORADOS por la API.
    page.drawEllipse({
      x: el.x + el.w / 2,
      y: yTop + el.h / 2,
      xScale: el.w / 2,
      yScale: el.h / 2,
      color: fill,
      borderColor: stroke,
      borderWidth: thickness,
    });
    return;
  }

  // rect / fallback. CSS renderiza el border DENTRO de la caja (border-
  // box); pdf-lib estampa el stroke centrado sobre el trazo (mitad
  // afuera). Para que el borde exterior coincida con la caja, insetamos
  // thickness/2 por lado.
  const inset = Math.max(0, thickness / 2);
  const opts = {
    x: el.x + inset,
    y: yTop + inset,
    width: Math.max(0, el.w - thickness),
    height: Math.max(0, el.h - thickness),
    borderColor: stroke,
    borderWidth: thickness,
  };
  if (fill) opts.color = fill;
  page.drawRectangle(opts);
}

// ── Composición principal ───────────────────────────────────────────
async function composeCredentialsPdf({ pdfMeta, sides, students, school, schoolYear }) {
  const fondoBytes = await fetchFondo(pdfMeta);
  const base = await PDFDocument.load(fondoBytes);
  const out = await PDFDocument.create();

  const fonts = {
    regular: await out.embedFont(StandardFonts.Helvetica),
    bold: await out.embedFont(StandardFonts.HelveticaBold),
  };

  // Pre-carga las páginas del fondo (una vez; se dibujan por cada alumno).
  // sides puede traer menos entradas que páginas: las caras sin elementos
  // igual se imprimen (solo con el marco del PDF).
  //
  // CropBox ∩ MediaBox: pdf.js muestra exactamente este rect (transform de
  // viewport → -x*s, y1*s mapea el rect a (0,0)). pdf-lib por defecto
  // usa {left:0,bottom:0,width,height} y matriz identidad → con un PDF
  // cuyo MediaBox tenga origen ≠ 0, el fondo aparece RECORRIDO y el
  // borde superior queda recortado. Pasar el view rect como boundingBox
  // hace que pdf-lib aplique translate(-left,-bottom) y deje el contenido
  // en la misma posición que el lienzo (1:1 píxel-a-píxel).
  const pageCount = base.getPageCount();
  const embedded = [];
  for (let p = 0; p < pageCount; p++) {
    const src = base.getPage(p);
    const mb = src.getMediaBox();
    const cb = src.getCropBox();
    const view = {
      left: Math.max(mb.x, cb.x),
      bottom: Math.max(mb.y, cb.y),
      right: Math.min(mb.x + mb.width, cb.x + cb.width),
      top: Math.min(mb.y + mb.height, cb.y + cb.height),
    };
    const w = view.right - view.left;
    const h = view.top - view.bottom;
    // Fit del fondo en el marco horizontal canónico (lo que ve el editor).
    const fitOld = fitBackground(w, h, CR80_WIDTH_PT, CR80_HEIGHT_PT);
    embedded[p] = {
      page: await out.embedPage(src, view),
      viewW: w,
      viewH: h,
      fitOld,
    };
  }

  // Orientación de la página de salida: la dicta la página 0 del fondo
  // (vertical si view.h > view.w). Todas las páginas comparten tamaño para
  // que el duplex del ZC300 alinee correctamente ambas caras de la tarjeta.
  const firstViewW = embedded[0]?.viewW || CR80_WIDTH_PT;
  const firstViewH = embedded[0]?.viewH || CR80_HEIGHT_PT;
  const outPortrait = firstViewH > firstViewW;
  const frameW = outPortrait ? CR80_HEIGHT_PT : CR80_WIDTH_PT;
  const frameH = outPortrait ? CR80_WIDTH_PT : CR80_HEIGHT_PT;

  // Prefetch de fotos únicas en paralelo (limitado).
  const photoUrls = [
    ...new Set(students.map((s) => s.photoUrl).filter(Boolean)),
  ];
  const fotoCache = new Map(); // url → { bytes, kind, image? }
  await pool(photoUrls, 6, async (url) => {
    const foto = await fetchFoto(url);
    if (foto) fotoCache.set(url, foto);
    else fotoCache.set(url, null); // recuerda el fallo (placeholder)
  });

  // Logos de la escuela (los sube el usuario en el diseñador CR80). Se
  // deduplicán por public_id/asset_id para no descargar el mismo varias
  // veces por cara/alumno.
  const logoIndex = new Map(); // logoId → { url, public_id, format }
  const logoEntries = [];
  const logosCfg = Array.isArray(school.credentialConfig?.logos)
    ? school.credentialConfig.logos
    : [];
  for (const lg of logosCfg) {
    if (lg && lg.id && lg.url) {
      logoIndex.set(lg.id, lg);
      logoEntries.push(lg);
    }
  }
  const logoCache = new Map(); // logoId → { bytes, kind, image? }
  await pool(logoEntries, 4, async (lg) => {
    const got = await fetchLogoBytes(lg);
    if (got) logoCache.set(lg.id, got);
    else logoCache.set(lg.id, null);
  });

  for (const student of students) {
    const data = buildTemplateData({
      student,
      group: student.current_group_id,
      school,
      schoolYear,
    });

    for (let p = 0; p < pageCount; p++) {
      const { page: bgPage, fitOld } = embedded[p];
      // Fit del mismo fondo dentro del marco de salida (horizontal o vertical).
      const fitNew = fitBackground(
        embedded[p].viewW,
        embedded[p].viewH,
        frameW,
        frameH,
      );
      const page = out.addPage([frameW, frameH]);
      page.drawPage(bgPage, {
        x: fitNew.x,
        y: fitNew.y,
        xScale: fitNew.scale,
        yScale: fitNew.scale,
      });

      const elements = sides[p]?.elements || [];
      for (const el of elements) {
        const mapped = transformElement(el, fitOld, fitNew, frameW, frameH);
        if (mapped.kind === "photo") {
          await stampPhoto(page, out, mapped, data, fotoCache, frameH);
        } else if (mapped.kind === "text") {
          stampText(page, fonts, mapped, data, frameH);
        } else if (mapped.kind === "logo") {
          await stampLogo(page, out, mapped, logoCache, frameH);
        } else if (mapped.kind === "shape") {
          stampShape(page, mapped, frameH);
        }
      }
    }
  }

  return Buffer.from(await out.save());
}

// Invalida la caché de fondos (p. ej. al cambiar el template de una escuela).
function clearFondoCache(url) {
  if (url) fondoCache.delete(url);
  else fondoCache.clear();
}

module.exports = {
  composeCredentialsPdf,
  fetchFondo,
  clearFondoCache,
};
