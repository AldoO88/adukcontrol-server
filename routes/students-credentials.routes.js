// Router de Credenciales
// Genera PDFs de credenciales escolares en formato A4 (1 credencial por
// página). Endpoint único:
//
// GET /api/students/credentials?school_year_id=...&ids=a,b,c
//   - ids opcional: si se omite, genera credencial para todos los
//     alumnos activos del ciclo. Si se pasa, solo para esos IDs.
//   - Devuelve application/pdf stream con Content-Disposition: attachment.
//
// Auth: admin / registrar / super_admin.
const express = require("express");
const { Router } = express;
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  generateCredentialsPdf,
} = require("../controllers/credentials.controller");

const router = Router();

router.get(
  "/",
  isAuthenticated,
  authorize("admin", "registrar", "super_admin"),
  generateCredentialsPdf
);

module.exports = router;
