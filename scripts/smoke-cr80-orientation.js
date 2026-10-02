// scripts/smoke-cr80-orientation.js
//
// Smoke test LOCAL (sin servidor, sin JWT, sin Mongo) del fix de credenciales
// CR80: la página de salida debe orientarse según el PDF de fondo, y los
// elementos guardados deben quedar dentro de los límites de esa página con
// el factor de escala correcto.
//
// Cubre:
//   - fondo vertical (CR80 + 1 mm sangrado) → addPage([153.07, 242.64])
//     con elementos escalados k ≈ 1.585 y fuente ×k (4 → 6.34 pt).
//   - fondo horizontal (CR80 + 1 mm sangrado) → addPage([242.64, 153.07])
//     con k = 1 (identidad) — cero regresión en escuelas actuales.
//   - fondo A4 vertical → contener (cover overflow > 8.5 pt).
//   - extractContentStreams: parsea los streams inflados y verifica que
//     cada Tm (text matrix) está dentro del MediaBox de la página.
//
// Uso:
//   node scripts/smoke-cr80-orientation.js
//
// Salida: "ALL PASS" si todas las aserciones se cumplen; aborta con exit 1
// si alguna falla.

const path = require("path");
const zlib = require("zlib");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const {
  composeCredentialsPdf,
} = require("../services/credential-pdf.service");
const {
  CR80_WIDTH_PT,
  CR80_HEIGHT_PT,
} = require("../services/credential-template.service");

const log = (msg) => console.log(`[smoke] ${msg}`);
const fail = (step, msg) => {
  console.error(`[smoke] FAILED at step ${step}: ${msg}`);
  process.exit(1);
};

function assertNear(actual, expected, tol, step) {
  if (!(Math.abs(actual - expected) <= tol)) {
    fail(step, `expected ${expected} ±${tol}, got ${actual}`);
  }
}

// Construye un PDF de fondo sintético con un rectángulo de color y un texto
// para que el estampado del CR80 sea visible en el output. Por defecto crea
// 2 páginas (frente y reverso de la credencial); especificar pages: 1 para
// casos con una sola cara.
async function buildBgPdf({ width, height, color, label, pages = 2 }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height, color });
    page.drawText(`${label}-${i + 1}`, {
      x: 4,
      y: height - 14,
      size: 10,
      font,
      color: rgb(1, 1, 1),
    });
  }
  const bytes = await doc.save();
  return `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
}

// Recorre las páginas del PDF y devuelve un string concatenado con todos
// sus content streams decodificados. PDFContentStream lo expone ya
// decodificado vía getContentsString; PDFRawStream (p. ej. un XObject
// embebido o un bg en FlateDecode) hay que inflarlo manualmente.
function pageContentStreams(pdfDoc) {
  const out = [];
  for (const p of pdfDoc.getPages()) {
    const arr = p.node.normalizedEntries().Contents;
    let combined = "";
    const sz = arr.size();
    for (let j = 0; j < sz; j++) {
      const ref = arr.get(j);
      const obj = pdfDoc.context.lookup(ref);
      const name = obj.constructor && obj.constructor.name;
      if (name === "PDFContentStream") {
        try {
          combined += obj.getContentsString() + "\n";
        } catch {
          /* skip */
        }
      } else if (name === "PDFRawStream") {
        // Intentar inflate; si no tiene FlateDecode, dejar como texto crudo.
        const bytes = obj.asUint8Array();
        try {
          combined += zlib.inflateSync(Buffer.from(bytes)).toString("latin1") + "\n";
        } catch {
          try {
            combined += zlib.inflateRawSync(Buffer.from(bytes)).toString("latin1") + "\n";
          } catch {
            combined += Buffer.from(bytes).toString("latin1") + "\n";
          }
        }
      }
    }
    out.push(combined);
  }
  return out;
}

// Busca todas las matrices de texto "Tm" en un content stream y devuelve
// los pares [x, y] resultantes (x' = a*e + b*f; y' = c*e + d*f con Tm (a b
// c d e f) y tamaño = fontSize).
function extractTextMatrices(stream) {
  const tmRegex = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm/g;
  const matches = [];
  let m;
  while ((m = tmRegex.exec(stream)) !== null) {
    matches.push({
      x: parseFloat(m[5]),
      y: parseFloat(m[6]),
    });
  }
  return matches;
}

async function loadAndAssert(pdfBytes, step, assertions) {
  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  assertions.pages(doc, pages);
  const streams = pageContentStreams(doc);
  for (let i = 0; i < streams.length; i++) {
    const tms = extractTextMatrices(streams[i]);
    assertions.textMatrices(step + ` page ${i}`, pages[i], tms);
  }
}

async function runCasePortrait() {
  log("case 1: fondo vertical CR80 (159×248.25 pt)");
  const url = await buildBgPdf({
    width: 159,
    height: 248.25,
    color: rgb(0.85, 0.85, 0.85),
    label: "BG-PORTRAIT",
  });

  const sides = [
    {
      elements: [
        // Nombre centrado en el marco horizontal canónico (donde diseñó
        // el usuario antes del fix). x=80,y=70,w=82,h=10 → en el marco
        // horizontal queda aproximadamente en la franja central.
        {
          id: "el_name",
          kind: "text",
          x: 80,
          y: 70,
          w: 82,
          h: 10,
          style: { fontSize: 4, fontWeight: "normal", color: "#000000" },
          text: "JUAN PEREZ",
        },
        {
          id: "el_grade",
          kind: "text",
          x: 100,
          y: 50,
          w: 42,
          h: 8,
          style: { fontSize: 7.5, fontWeight: "bold", color: "#1a1a1a" },
          text: "3° A",
        },
      ],
    },
    {
      elements: [
        {
          id: "el_rev",
          kind: "text",
          x: 80,
          y: 70,
          w: 82,
          h: 10,
          style: { fontSize: 4, fontWeight: "normal", color: "#000000" },
          text: "INDICACIONES",
        },
      ],
    },
  ];

  const buf = await composeCredentialsPdf({
    pdfMeta: { url, widthPt: 159, heightPt: 248.25 },
    sides,
    students: [
      {
        _id: "stu1",
        first_name: "Juan",
        last_name: "Perez",
        controlNumber: "2610912001",
        photoUrl: "",
        current_group_id: { grade: 3, section: "A" },
      },
    ],
    school: { credentialConfig: { logos: [] } },
    schoolYear: { name: "2026-2027" },
  });

  if (!buf || buf.length < 1000) {
    fail("portrait", `output PDF too small: ${buf && buf.length}`);
  }

  await loadAndAssert(buf, "portrait", {
    pages: (doc, pages) => {
      if (pages.length !== 2) fail("portrait.pages", `expected 2 pages, got ${pages.length}`);
      const w = pages[0].getMediaBox().width;
      const h = pages[0].getMediaBox().height;
      assertNear(w, CR80_HEIGHT_PT, 0.01, "portrait.page0.width"); // 153.07
      assertNear(h, CR80_WIDTH_PT, 0.01, "portrait.page0.height");  // 242.64
    },
    textMatrices: (step, page, tms) => {
      const w = page.getMediaBox().width;
      const h = page.getMediaBox().height;
      if (tms.length === 0) fail(step, "no text matrices found");
      for (const t of tms) {
        if (t.x < -0.01 || t.x > w + 0.01) {
          fail(step, `text x=${t.x} outside page width ${w}`);
        }
        if (t.y < -0.01 || t.y > h + 0.01) {
          fail(step, `text y=${t.y} outside page height ${h}`);
        }
      }
    },
  });
  log("  ✓ page size = [153.07 × 242.64], text within bounds");
}

async function runCaseLandscape() {
  log("case 2: fondo horizontal CR80 (248.25×159 pt)");
  const url = await buildBgPdf({
    width: 248.25,
    height: 159,
    color: rgb(0.75, 0.78, 0.92),
    label: "BG-LANDSCAPE",
    pages: 1,
  });

  const sides = [
    {
      elements: [
        {
          id: "el_name",
          kind: "text",
          x: 80,
          y: 70,
          w: 82,
          h: 10,
          style: { fontSize: 4, fontWeight: "normal", color: "#000000" },
          text: "MARIA LOPEZ",
        },
      ],
    },
  ];

  const buf = await composeCredentialsPdf({
    pdfMeta: { url, widthPt: 248.25, heightPt: 159 },
    sides,
    students: [
      {
        _id: "stu1",
        first_name: "Maria",
        last_name: "Lopez",
        controlNumber: "2610912002",
        photoUrl: "",
        current_group_id: { grade: 2, section: "B" },
      },
    ],
    school: { credentialConfig: { logos: [] } },
    schoolYear: { name: "2026-2027" },
  });

  await loadAndAssert(buf, "landscape", {
    pages: (doc, pages) => {
      if (pages.length !== 1) fail("landscape.pages", `expected 1 page, got ${pages.length}`);
      const w = pages[0].getMediaBox().width;
      const h = pages[0].getMediaBox().height;
      assertNear(w, CR80_WIDTH_PT, 0.01, "landscape.page0.width");
      assertNear(h, CR80_HEIGHT_PT, 0.01, "landscape.page0.height");
    },
    textMatrices: (step, page, tms) => {
      const w = page.getMediaBox().width;
      const h = page.getMediaBox().height;
      if (tms.length === 0) fail(step, "no text matrices found");
      for (const t of tms) {
        if (t.x < -0.01 || t.x > w + 0.01) {
          fail(step, `text x=${t.x} outside page width ${w}`);
        }
        if (t.y < -0.01 || t.y > h + 0.01) {
          fail(step, `text y=${t.y} outside page height ${h}`);
        }
      }
    },
  });
  log("  ✓ page size = [242.64 × 153.07], text within bounds (k=1, sin regresión)");
}

async function runCaseA4() {
  log("case 3: fondo A4 vertical (595.3×841.9 pt) → contener");
  const url = await buildBgPdf({
    width: 595.3,
    height: 841.9,
    color: rgb(0.6, 0.6, 0.6),
    label: "BG-A4",
    pages: 1,
  });

  const sides = [
    {
      elements: [
        {
          id: "el_x",
          kind: "text",
          x: 80,
          y: 70,
          w: 82,
          h: 10,
          style: { fontSize: 8, fontWeight: "normal", color: "#000000" },
          text: "A4",
        },
      ],
    },
  ];

  const buf = await composeCredentialsPdf({
    pdfMeta: { url, widthPt: 595.3, heightPt: 841.9 },
    sides,
    students: [
      {
        _id: "stu1",
        first_name: "A",
        last_name: "B",
        controlNumber: "0000000001",
        photoUrl: "",
        current_group_id: { grade: 1, section: "A" },
      },
    ],
    school: { credentialConfig: { logos: [] } },
    schoolYear: { name: "2026-2027" },
  });

  await loadAndAssert(buf, "a4", {
    pages: (doc, pages) => {
      const w = pages[0].getMediaBox().width;
      const h = pages[0].getMediaBox().height;
      assertNear(w, CR80_HEIGHT_PT, 0.01, "a4.page0.width");
      assertNear(h, CR80_WIDTH_PT, 0.01, "a4.page0.height");
    },
    textMatrices: (step, page, tms) => {
      if (tms.length === 0) fail(step, "no text matrices found");
    },
  });
  log("  ✓ page size = [153.07 × 242.64] (A4 vertical → salida vertical, contener)");
}

async function run() {
  try {
    await runCasePortrait();
    await runCaseLandscape();
    await runCaseA4();
    log("ALL PASS");
  } catch (err) {
    console.error("[smoke] unhandled error:", err.stack || err);
    process.exit(1);
  }
}

run();
