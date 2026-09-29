// Layout de texto CR80 — ESPECIFICACIÓN IDÉNTICA a
// edukcontrol-web/src/lib/cr80-text-layout.ts (mantener AMBOS idénticos;
// el test de paridad /var/folders/.../opencode/parity-cr80-text.js compara
// ambos algoritmos).
//
//   1. Párrafos = texto partido por "\n"; vacíos se ignoran.
//   2. Wrap voraz al ancho de la caja (palabras; palabras más anchas que
//      la caja se cortan por caracteres).
//   3. Auto-shrink: baja de 0.5 en 0.5 (piso 4) hasta que todas las
//      líneas quepan en el ancho Y el bloque (n × size × 1.2) en el alto.
//   4. Safety: si aún hay más líneas de las que caben, se truncan.
//
// widthAt(text, size) usa font.widthOfTextAtSize de pdf-lib en el
// backend; el frontend usa la tabla generada con números idénticos.

const MIN_FONT_PT = 4;
const MAX_FONT_PT = 96;
const LINE_SPACING = 1.2;

function wrapParagraphs(paragraphs, boxW, size, widthAt) {
  const out = [];
  for (const p of paragraphs) {
    if (p === "") continue;
    const words = p.split(/\s+/).filter((w) => w.length > 0);
    let cur = "";
    for (const word of words) {
      const cand = cur === "" ? word : `${cur} ${word}`;
      if (widthAt(cand, size) <= boxW) {
        cur = cand;
        continue;
      }
      if (cur !== "") {
        out.push(cur);
        cur = "";
      }
      if (widthAt(word, size) <= boxW) {
        cur = word;
        continue;
      }
      // Palabra más ancha que la caja → corte por caracteres.
      let chunk = "";
      for (const ch of Array.from(word)) {
        if (chunk !== "" && widthAt(chunk + ch, size) > boxW) {
          out.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      cur = chunk;
    }
    if (cur !== "") out.push(cur);
  }
  return out;
}

// paragraphs: string[] (texto ya partido por \n y filtrado de vacíos)
// Devuelve { lines, size } listo para estampar/renderizar.
function layoutCr80Text(paragraphs, boxW, boxH, requestedSize, widthAt) {
  const w = Math.max(4, boxW);
  const h = Math.max(4, boxH);
  const requested = Number.isFinite(requestedSize) ? requestedSize : 16;
  let size = Math.min(MAX_FONT_PT, Math.max(MIN_FONT_PT, requested));
  let lines = wrapParagraphs(paragraphs, w, size, widthAt);

  const fits = () =>
    !lines.some((l) => widthAt(l, size) > w) &&
    lines.length * size * LINE_SPACING <= h;

  while (!fits() && size > MIN_FONT_PT) {
    size = Math.max(MIN_FONT_PT, size - 0.5);
    lines = wrapParagraphs(paragraphs, w, size, widthAt);
  }

  const maxLines = Math.max(
    1,
    Math.floor(h / (size * LINE_SPACING) + 1e-9)
  );
  if (lines.length > maxLines) lines = lines.slice(0, maxLines);
  return { lines, size };
}

module.exports = { layoutCr80Text, wrapParagraphs };
