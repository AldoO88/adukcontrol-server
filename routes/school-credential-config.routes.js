// Router de Configuración de Credenciales
// Gestiona el template de credenciales: designer solo-PDF (CR80), los
// logos (imágenes reusables en el lienzo), el layout visual legacy y la
// configuración de credenciales por escuela.
//
// GET    /api/schools/:schoolId/credential-template          → template + pdf + sides + config + logos
// GET    /api/schools/:schoolId/credential-template/background → PDF de fondo (proxy; delivery de PDFs bloqueado en Cloudinary)
// PUT    /api/schools/:schoolId/credential-template          → guardar template/pdf/sides/config
// POST   /api/schools/:schoolId/credential-template/assets   → subir PDF de fondo a Cloudinary (raw)
//
// Logos reusables del diseñador CR80 (en School.credentialConfig.logos):
// GET    /api/schools/:schoolId/credential-template/logos     → lista
// POST   /api/schools/:schoolId/credential-template/logos     → subir logo (multipart "logo")
// DELETE /api/schools/:schoolId/credential-template/logos/:logoId → borrar
const express = require("express");
const { Router } = express;
const { PDFDocument } = require("pdf-lib");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  uploadPdfSingle,
  uploadSingle,
} = require("../middleware/upload.middleware");
const { uploadBufferWithRetry } = require("../services/cloudinary-upload.service");
const { sanitizeLayout } = require("../services/credential-layout.service");
const { fetchFondo } = require("../services/credential-pdf.service");
const {
  sanitizeTemplatePdf,
  sanitizeSides,
  MAX_PDF_PAGES,
} = require("../services/credential-template.service");
const School = require("../models/School.model");
require("../config/cloudinary");
const cloudinary = require("cloudinary").v2;

const router = Router({ mergeParams: true });

router.use(isAuthenticated);

// El schoolId del path debe pertenecer al tenant del usuario (salvo super_admin).
function tenantFilterFor(req) {
  if (req.payload.role === "super_admin") return {};
  return { _id: req.payload.schoolId };
}

// GET /api/schools/:schoolId/credential-template
router.get(
  "/",
  authorize("admin", "principal", "super_admin"),
  async (req, res, next) => {
    try {
      const { schoolId } = req.params;
      const school = await School.findOne({ _id: schoolId, ...tenantFilterFor(req) })
        .select("credentialTemplate credentialConfig name cct logoUrl current_school_year_id")
        .lean();
      if (!school) {
        return res.status(404).json({ message: "School not found." });
      }
      const logos = Array.isArray(school.credentialConfig?.logos)
        ? school.credentialConfig.logos.map(sanitizeLogoEntry).filter(Boolean)
        : [];
      res.json({
        html: school.credentialTemplate?.html || null,
        layout: school.credentialTemplate?.layout || null,
        pdf: school.credentialTemplate?.pdf || null,
        sides: school.credentialTemplate?.sides || null,
        updatedAt: school.credentialTemplate?.updatedAt || null,
        config: school.credentialConfig || {},
        logos,
        schoolName: school.name,
        cct: school.cct,
        logoUrl: school.logoUrl || null,
        activeSchoolYearId: school.current_school_year_id || null,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/schools/:schoolId/credential-template/background
// Proxy binario del PDF de fondo: la entrega directa de PDFs en Cloudinary
// responde 401 en esta cuenta, así que el servidor lo descarga (admin API,
// con caché) y lo sirve al editor (pdf.js) con las credenciales del JWT.
router.get(
  "/background",
  authorize("admin", "principal", "super_admin"),
  async (req, res, next) => {
    try {
      const { schoolId } = req.params;
      const school = await School.findOne({ _id: schoolId, ...tenantFilterFor(req) })
        .select("credentialTemplate")
        .lean();
      const pdfMeta = school?.credentialTemplate?.pdf;
      if (!school || !pdfMeta) {
        return res.status(404).json({ message: "Background PDF not found." });
      }
      const bytes = await fetchFondo(pdfMeta);
      res.set("Content-Type", "application/pdf");
      res.set("Cache-Control", "private, max-age=300");
      res.send(bytes);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/schools/:schoolId/credential-template
router.put(
  "/",
  authorize("admin", "super_admin"),
  async (req, res, next) => {
    try {
      const { schoolId } = req.params;
      const { html, config } = req.body;
      const hasLayout = Object.prototype.hasOwnProperty.call(req.body, "layout");
      const hasPdf = Object.prototype.hasOwnProperty.call(req.body, "pdf");
      const hasSides = Object.prototype.hasOwnProperty.call(req.body, "sides");

      const school = await School.findOne({ _id: schoolId, ...tenantFilterFor(req) });
      if (!school) {
        return res.status(404).json({ message: "School not found." });
      }

      let touchedTemplate = false;
      // Reconstruimos el subdocumento completo y lo asignamos de una vez:
      // credentialTemplate usa Mixed, y asignar el path completo evita
      // problemas de tracking de modificaciones.
      const nextTemplate = {
        html: school.credentialTemplate?.html ?? null,
        layout: school.credentialTemplate?.layout ?? null,
        pdf: school.credentialTemplate?.pdf ?? null,
        sides: school.credentialTemplate?.sides ?? null,
        updatedAt: school.credentialTemplate?.updatedAt ?? null,
      };

      if (typeof html === "string") {
        nextTemplate.html = html;
        touchedTemplate = true;
      }

      if (hasLayout) {
        // null limpia el diseño; objetos pasan por la whitelist.
        const cleanLayout =
          req.body.layout === null ? null : sanitizeLayout(req.body.layout);
        if (req.body.layout !== null && !cleanLayout) {
          return res.status(400).json({ message: "Invalid layout." });
        }
        nextTemplate.layout = cleanLayout;
        touchedTemplate = true;
      }

      if (hasPdf) {
        // null quita el PDF de fondo; objetos pasan por la whitelist.
        const cleanPdf =
          req.body.pdf === null ? null : sanitizeTemplatePdf(req.body.pdf);
        if (req.body.pdf !== null && !cleanPdf) {
          return res.status(400).json({ message: "Invalid pdf." });
        }
        nextTemplate.pdf = cleanPdf;
        touchedTemplate = true;
      }

      if (hasSides) {
        const cleanSides =
          req.body.sides === null ? null : sanitizeSides(req.body.sides);
        if (req.body.sides !== null && !cleanSides) {
          return res.status(400).json({ message: "Invalid sides." });
        }
        // Sin PDF de fondo no hay dónde ubicar los elementos.
        if (cleanSides && cleanSides.length > 0 && !nextTemplate.pdf) {
          return res
            .status(400)
            .json({ message: "Cannot place elements without a background PDF." });
        }
        // Un lado por página del PDF (frente/reverso).
        if (cleanSides && nextTemplate.pdf && cleanSides.length > nextTemplate.pdf.pages) {
          return res
            .status(400)
            .json({ message: "More sides than pages in the background PDF." });
        }
        nextTemplate.sides = cleanSides;
        touchedTemplate = true;
      }

      if (touchedTemplate) {
        nextTemplate.updatedAt = new Date();
        school.credentialTemplate = nextTemplate;
      }

      if (config && typeof config === "object") {
        school.credentialConfig = {
          dgetLogoUrl: config.dgetLogoUrl || null,
          iheLogoUrl: config.iheLogoUrl || null,
          watermarkUrl: config.watermarkUrl || null,
          directorName: config.directorName || null,
          values: config.values || null,
          city: config.city || null,
          indications: Array.isArray(config.indications) ? config.indications : [],
        };
      }

      if (!touchedTemplate && !(config && typeof config === "object")) {
        return res.status(400).json({ message: "No valid fields to update." });
      }

      await school.save();

      res.json({
        message: "Credential config saved successfully.",
        updatedAt: school.credentialTemplate?.updatedAt || null,
        hasHtml: !!school.credentialTemplate?.html,
        hasLayout: !!school.credentialTemplate?.layout,
        hasPdf: !!school.credentialTemplate?.pdf,
        sidesCount: Array.isArray(school.credentialTemplate?.sides)
          ? school.credentialTemplate.sides.length
          : 0,
        config: school.credentialConfig || {},
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/schools/:schoolId/credential-template/assets
// Sube el PDF de fondo original (diseñado en Canva/Illustrator/Photoshop,
// sin datos de alumnos) a Cloudinary como "raw" (bytes intactos) y devuelve
// la URL fija + metadatos de las páginas (para el editor CR80).
// Field: "background" (application/pdf ≤10MB, 1–2 páginas: frente/reverso).
router.post(
  "/assets",
  authorize("admin", "super_admin"),
  uploadPdfSingle("background"),
  async (req, res, next) => {
    try {
      const { schoolId } = req.params;
      const school = await School.findOne({ _id: schoolId, ...tenantFilterFor(req) })
        .select("_id")
        .lean();
      if (!school) {
        return res.status(404).json({ message: "School not found." });
      }
      if (!req.file) {
        return res.status(400).json({ message: "background file is required." });
      }

      const buffer = req.file.buffer;
      // Validación de magia: el mimetype lo puso el cliente.
      if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
        return res.status(400).json({ message: "File is not a valid PDF." });
      }

      // Validar que pdf-lib pueda abrirlo y leer sus páginas antes de subir.
      let pages;
      let widthPt;
      let heightPt;
      try {
        const doc = await PDFDocument.load(buffer);
        pages = doc.getPageCount();
        const size = doc.getPage(0).getSize();
        widthPt = Math.round(size.width * 100) / 100;
        heightPt = Math.round(size.height * 100) / 100;
      } catch (e) {
        return res
          .status(400)
          .json({ message: `Unreadable PDF: ${e.message}`.slice(0, 200) });
      }
      if (pages > MAX_PDF_PAGES) {
        return res.status(400).json({
          message: `The PDF must have 1 or ${MAX_PDF_PAGES} pages (front/back). It has ${pages}.`,
        });
      }

      const publicId = `bg_${schoolId}_${Date.now()}.pdf`;
      const result = await uploadBufferWithRetry(buffer, {
        folder: `edukcontrol/schools/${schoolId}/credentials`,
        public_id: publicId,
        overwrite: false,
        invalidate: true,
        resource_type: "raw",
      });

      res.status(201).json({
        url: result.secure_url,
        public_id: result.public_id || publicId,
        asset_id: result.asset_id || null,
        pages,
        widthPt,
        heightPt,
        bytes: buffer.length,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ──── Logos reusables del diseñador CR80 ────────────────────────────
// Cada logo es una imagen subida a Cloudinary (no es fondo, es elemento
// gráfico que el usuario puede arrastrar al lienzo y reusar). Persistimos
// la lista en School.credentialConfig.logos y propagamos `id` al elemento
// del lienzo para que el backend pueda resolver el asset al estampar.

function sanitizeLogoEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id.slice(0, 64) : "";
  const url = typeof raw.url === "string" ? raw.url.slice(0, 512) : "";
  const public_id =
    typeof raw.public_id === "string" ? raw.public_id.slice(0, 256) : "";
  if (!id || !/^https:\/\/res\.cloudinary\.com\//.test(url) || !public_id) return null;
  return {
    id,
    url,
    public_id,
    asset_id: typeof raw.asset_id === "string" ? raw.asset_id.slice(0, 128) : null,
    format: typeof raw.format === "string" ? raw.format.toLowerCase().slice(0, 8) : null,
    label: typeof raw.label === "string" ? raw.label.slice(0, 80) : "",
    width: Number.isFinite(raw.width) ? Math.round(raw.width) : null,
    height: Number.isFinite(raw.height) ? Math.round(raw.height) : null,
    bytes: Number.isFinite(raw.bytes) ? Math.round(raw.bytes) : null,
    createdAt: raw.createdAt || null,
  };
}

router.get(
  "/logos",
  authorize("admin", "principal", "super_admin"),
  async (req, res, next) => {
    try {
      const { schoolId } = req.params;
      const school = await School.findOne(
        { _id: schoolId, ...tenantFilterFor(req) }
      ).select("credentialConfig");
      const raw =
        school && Array.isArray(school.credentialConfig?.logos)
          ? school.credentialConfig.logos
          : [];
      res.json({ logos: raw.map(sanitizeLogoEntry).filter(Boolean) });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/logos",
  authorize("admin", "super_admin"),
  uploadSingle("logo"),
  async (req, res, next) => {
    try {
      const { schoolId } = req.params;
      const school = await School.findOne(
        { _id: schoolId, ...tenantFilterFor(req) }
      ).select("_id credentialConfig");
      if (!school) return res.status(404).json({ message: "School not found." });
      if (!req.file) return res.status(400).json({ message: "logo file is required." });

      const buffer = req.file.buffer;
      const mimetype = req.file.mimetype;
      const isSvg = mimetype === "image/svg+xml";
      // Formato preferido para pdf-lib → png; jpg / webp se transforman;
      // svg se sube tal cual (vectorial).
      const transforms = isSvg ? [] : [{ quality: "auto", fetch_format: "png" }];

      const publicId = `logo_${schoolId}_${Date.now()}`;
      const result = await uploadBufferWithRetry(buffer, {
        folder: `edukcontrol/schools/${schoolId}/logos/designer`,
        public_id: publicId,
        overwrite: false,
        invalidate: true,
        resource_type: "image",
        transformation: transforms,
      });

      const entry = {
        id: `lg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        url: result.secure_url,
        public_id: result.public_id || publicId,
        asset_id: result.asset_id || null,
        format: isSvg ? "svg" : "png",
        label: (req.body && req.body.label) || req.file.originalname || "",
        width: result.width || null,
        height: result.height || null,
        bytes: buffer.length,
        createdAt: new Date(),
      };

      const clean = sanitizeLogoEntry(entry);
      if (!clean) return res.status(500).json({ message: "Logo entry invalid." });

      const nextLogos = Array.isArray(school.credentialConfig?.logos)
        ? [...school.credentialConfig.logos, clean]
        : [clean];
      // Tope razonable para no acumular infinitamente.
      if (nextLogos.length > 20) {
        const dropped = nextLogos.splice(0, nextLogos.length - 20);
        for (const d of dropped) {
          try {
            await cloudinary.uploader.destroy(d.public_id, {
              resource_type: "image",
            });
          } catch {
            /* best-effort */
          }
        }
      }

      school.credentialConfig = {
        ...(school.credentialConfig || {}),
        logos: nextLogos,
      };
      await school.save();

      res.status(201).json({ logo: clean });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/logos/:logoId",
  authorize("admin", "super_admin"),
  async (req, res, next) => {
    try {
      const { schoolId, logoId } = req.params;
      const school = await School.findOne(
        { _id: schoolId, ...tenantFilterFor(req) }
      ).select("credentialConfig");
      if (!school) return res.status(404).json({ message: "School not found." });
      const list = Array.isArray(school.credentialConfig?.logos)
        ? school.credentialConfig.logos
        : [];
      const idx = list.findIndex((l) => l && l.id === logoId);
      if (idx === -1) return res.status(404).json({ message: "Logo not found." });
      const dropped = list[idx];
      const nextLogos = list.filter((_, i) => i !== idx);
      school.credentialConfig = {
        ...(school.credentialConfig || {}),
        logos: nextLogos,
      };
      await school.save();
      // Limpieza best-effort en Cloudinary.
      if (dropped && dropped.public_id) {
        try {
          await cloudinary.uploader.destroy(dropped.public_id, {
            resource_type: "image",
          });
        } catch {
          /* best-effort */
        }
      }
      res.json({ logos: nextLogos.map(sanitizeLogoEntry).filter(Boolean) });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
