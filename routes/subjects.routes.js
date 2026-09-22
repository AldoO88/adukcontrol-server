// Router de Materias (Subject)
const express = require("express");
const { isAuthenticated } = require("../middleware/jwt.middleware");
const { authorize } = require("../middleware/authorize.middleware");
const {
  getAllSubjects,
  getSubjectById,
  createSubject,
  updateSubject,
  deleteSubject,
} = require("../controllers/subjects.controller");

const { Router } = express;
const router = Router();

router.use(isAuthenticated);

router.get("/", authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"), getAllSubjects);
router.post("/", authorize("admin", "registrar", "super_admin"), createSubject);
router.get("/:subjectId", authorize("admin", "principal", "registrar", "teacher", "prefect", "social_worker", "super_admin"), getSubjectById);
router.put("/:subjectId", authorize("admin", "registrar", "super_admin"), updateSubject);
router.delete("/:subjectId", authorize("admin", "registrar"), deleteSubject);

module.exports = router;
