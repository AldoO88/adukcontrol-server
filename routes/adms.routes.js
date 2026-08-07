// Router ADMS (ZKTeco Push SDK)
// Se monta en /iclock (NO bajo /api): la ruta está fija en el firmware de las
// terminales, que solo permite configurar host y puerto.
//
// Auth: número de serie (SN) en el query string contra una lista blanca —
// el firmware no puede mandar cabeceras personalizadas. Ver
// middleware/device.middleware.js#verifyAdmsDevice.
const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  handleZkTecoPush,
  handleZkTecoHandshake,
  handleZkTecoGetRequest,
  handleZkTecoDeviceCmd,
} = require("../controllers/adms.controller");
const { verifyAdmsDevice } = require("../middleware/device.middleware");

const { Router } = express;
const router = Router();

// Las terminales hacen polling de comandos cada pocos segundos y empujan
// lotes en horas pico (entrada/salida), así que el límite es más alto que el
// del endpoint de lectores propios.
const admsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  // El firmware no interpreta JSON: hay que responderle texto plano.
  handler: (req, res) =>
    res.type("text/plain").status(429).send("Too many requests"),
});

// El ATTLOG llega como texto plano tab-separado y a veces SIN Content-Type,
// así que los parsers globales (json/urlencoded) lo dejarían vacío.
// `type: () => true` fuerza a que cualquier body no consumido antes llegue
// como String a req.body. Los integradores que mandan JSON siguen
// funcionando porque express.json() ya lo habrá parseado a objeto.
const attlogTextParser = express.text({ type: () => true, limit: "1mb" });

router.use(admsLimiter, verifyAdmsDevice);

// Handshake: la terminal pide su configuración antes de empezar a empujar.
router.get("/cdata", handleZkTecoHandshake);

// Push de marcajes (ATTLOG) — el endpoint principal.
router.post("/cdata", attlogTextParser, handleZkTecoPush);

// Polling de comandos pendientes y ACK de comandos.
router.get("/getrequest", handleZkTecoGetRequest);
router.post("/devicecmd", attlogTextParser, handleZkTecoDeviceCmd);

module.exports = router;
