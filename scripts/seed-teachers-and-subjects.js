// Script to create teachers, subjects, and teacher-subject assignments
// Based on the workload table provided by the user
require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

// Models
const School = require("../models/School.model");
const SchoolYear = require("../models/SchoolYear.model");
const Subject = require("../models/Subject.model");
const User = require("../models/User.model");
const Group = require("../models/Group.model");
const TeacherSubject = require("../models/TeacherSubject.model");

const SCHOOL_ID = "6a790cb141b48704e7d2d72e";
const SCHOOL_YEAR_ID = "6a790cb141b48704e7d2d735";

// Subject catalog
const subjects = [
  { code: "ING", name: "Inglés", educationalLevel: "BASIC" },
  { code: "QUI", name: "Química", educationalLevel: "BASIC" },
  { code: "TUT", name: "Tutoría", educationalLevel: "BASIC" },
  { code: "IC", name: "Integración Curricular", educationalLevel: "BASIC" },
  { code: "AV", name: "Artes Visuales", educationalLevel: "BASIC" },
  { code: "CIEN", name: "Ciencias I", educationalLevel: "BASIC" },
  { code: "FIS", name: "Física", educationalLevel: "BASIC" },
  { code: "ESP", name: "Español", educationalLevel: "BASIC" },
  { code: "ELEC", name: "Electrónica", educationalLevel: "BASIC" },
  { code: "MAT", name: "Matemáticas", educationalLevel: "BASIC" },
  { code: "OFI", name: "Ofimática", educationalLevel: "BASIC" },
  { code: "EST_MET", name: "Estructuras Metálicas", educationalLevel: "BASIC" },
  { code: "ED_FIS", name: "Educación Física", educationalLevel: "BASIC" },
  { code: "GEO", name: "Geografía", educationalLevel: "BASIC" },
  { code: "FCYE", name: "Formación Ciudadana y Ética", educationalLevel: "BASIC" },
  { code: "HIST_I", name: "Historia I", educationalLevel: "BASIC" },
  { code: "HIST_II", name: "Historia II", educationalLevel: "BASIC" },
  { code: "HIST_III", name: "Historia III", educationalLevel: "BASIC" },
  { code: "INF", name: "Informática", educationalLevel: "BASIC" },
  { code: "AM", name: "Artes Musicales", educationalLevel: "BASIC" },
];

// Teachers with their assignments
const teachers = [
  {
    name: "Juan Francisco",
    last_name: "Aguilar Luna",
    email: "juan.aguilar@sec47.edu.mx",
    phoneNumber: "7711234001",
    contractedHours: 6,
    assignments: [
      { subjectCode: "ING", groups: ["3A", "3B"], hours: 6 },
    ],
  },
  {
    name: "Araceli",
    last_name: "Baca Gomez",
    email: "araceli.baca@sec47.edu.mx",
    phoneNumber: "7711234002",
    contractedHours: 25,
    assignments: [
      { subjectCode: "QUI", groups: ["3A", "3B", "3C", "3D"], hours: 24 },
      { subjectCode: "TUT", groups: ["3D"], hours: 1 },
    ],
  },
  {
    name: "Angelica",
    last_name: "Lopez Valencia",
    email: "angelica.lopez@sec47.edu.mx",
    phoneNumber: "7711234003",
    contractedHours: 32,
    assignments: [
      { subjectCode: "ING", groups: ["1A", "1B", "1C", "1D", "2A", "2B", "2C", "2D", "3C", "3D"], hours: 30 },
      { subjectCode: "IC", groups: ["2D"], hours: 1 },
      { subjectCode: "TUT", groups: ["2B"], hours: 1 },
    ],
  },
  {
    name: "Salma Rebeca",
    last_name: "Cruz Hernandez",
    email: "salma.cruz@sec47.edu.mx",
    phoneNumber: "7711234004",
    contractedHours: 23,
    assignments: [
      { subjectCode: "AV", groups: ["1A", "1B", "1C"], hours: 9 },
      { subjectCode: "AV", groups: ["2A", "2B", "2C", "2D"], hours: 12 },
      { subjectCode: "IC", groups: ["1A", "1B"], hours: 2 },
    ],
  },
  {
    name: "Georgina",
    last_name: "Mariscal Navarro",
    email: "georgina.mariscal@sec47.edu.mx",
    phoneNumber: "7711234005",
    contractedHours: 23,
    assignments: [
      { subjectCode: "CIEN", groups: ["1A", "1B", "1C", "1D"], hours: 16 },
      { subjectCode: "FIS", groups: ["2A"], hours: 6 },
      { subjectCode: "IC", groups: ["2B"], hours: 1 },
    ],
  },
  {
    name: "Jonathan",
    last_name: "Dominguez Ramirez",
    email: "jonathan.dominguez@sec47.edu.mx",
    phoneNumber: "7711234006",
    contractedHours: 40,
    assignments: [
      { subjectCode: "ESP", groups: ["3A", "3B", "3C", "3D"], hours: 20 },
    ],
  },
  {
    name: "Jose Alberto",
    last_name: "Trejo Garcia",
    email: "jose.trejo@sec47.edu.mx",
    phoneNumber: "7711234007",
    contractedHours: 30,
    assignments: [
      { subjectCode: "ELEC", groups: ["1A", "1B", "1C", "1D", "2A", "2B", "2C", "2D", "3A", "3B", "3C", "3D"], hours: 24 },
      { subjectCode: "MAT", groups: ["3C"], hours: 5 },
      { subjectCode: "TUT", groups: ["3C"], hours: 1 },
    ],
  },
  {
    name: "Aldo Omar",
    last_name: "González Juárez",
    email: "aldo.gonzalez@sec47.edu.mx",
    phoneNumber: "7711234008",
    contractedHours: 28,
    assignments: [
      { subjectCode: "OFI", groups: ["1A", "1B", "1C", "1D", "2A", "2B", "2C", "2D", "3A", "3B", "3C", "3D"], hours: 24 },
      { subjectCode: "TUT", groups: ["3A", "1C"], hours: 2 },
      { subjectCode: "IC", groups: ["1C", "3A"], hours: 2 },
    ],
  },
  {
    name: "Francisco Gustavo",
    last_name: "Godinez",
    email: "francisco.godinez@sec47.edu.mx",
    phoneNumber: "7711234009",
    contractedHours: 24,
    assignments: [
      { subjectCode: "EST_MET", groups: ["1A", "1B", "1C", "1D", "2A", "2B", "2C", "2D", "3A", "3B", "3C", "3D"], hours: 24 },
    ],
  },
  {
    name: "Elibeth",
    last_name: "Moctezuma Hernandez",
    email: "elibeth.moctezuma@sec47.edu.mx",
    phoneNumber: "7711234010",
    contractedHours: 18,
    assignments: [
      { subjectCode: "MAT", groups: ["3A", "3B", "3D"], hours: 15 },
      { subjectCode: "IC", groups: ["2A", "3B"], hours: 2 },
      { subjectCode: "TUT", groups: ["2A"], hours: 1 },
    ],
  },
  {
    name: "Armando Efrain",
    last_name: "Moguel Vite",
    email: "armando.moguel@sec47.edu.mx",
    phoneNumber: "7711234011",
    contractedHours: 40,
    assignments: [
      { subjectCode: "MAT", groups: ["1A", "1B", "1C", "1D"], hours: 20 },
      { subjectCode: "MAT", groups: ["2A", "2B", "2C", "2D"], hours: 20 },
    ],
  },
  {
    name: "Omar",
    last_name: "Pontaza Castelazo",
    email: "omar.pontaza@sec47.edu.mx",
    phoneNumber: "7711234012",
    contractedHours: 28,
    assignments: [
      { subjectCode: "ED_FIS", groups: ["1A", "1B", "1C", "1D", "2A", "2B", "2C", "2D", "3A", "3B", "3C", "3D"], hours: 24 },
      { subjectCode: "TUT", groups: ["2C", "1D"], hours: 2 },
      { subjectCode: "IC", groups: ["1D", "2C"], hours: 2 },
    ],
  },
  {
    name: "Heriberto",
    last_name: "Romero Bartolo",
    email: "heriberto.romero@sec47.edu.mx",
    phoneNumber: "7711234013",
    contractedHours: 39,
    assignments: [
      { subjectCode: "GEO", groups: ["1A", "1B", "1C", "1D"], hours: 16 },
      { subjectCode: "FCYE", groups: ["1A", "1D", "2A", "2B", "2C", "2D", "3A", "3B", "3C", "3D"], hours: 20 },
      { subjectCode: "IC", groups: ["3C", "3D"], hours: 2 },
      { subjectCode: "TUT", groups: ["1A"], hours: 1 },
    ],
  },
  {
    name: "Elizabeth",
    last_name: "Sánchez Ramírez",
    email: "elizabeth.sanchez@sec47.edu.mx",
    phoneNumber: "7711234014",
    contractedHours: 40,
    assignments: [
      { subjectCode: "ESP", groups: ["1A", "1B", "1C", "1D"], hours: 20 },
      { subjectCode: "ESP", groups: ["2A", "2B", "2C", "2D"], hours: 20 },
    ],
  },
  {
    name: "José Luis",
    last_name: "Téllez Bazán",
    email: "jose.tellez@sec47.edu.mx",
    phoneNumber: "7711234015",
    contractedHours: 33,
    assignments: [
      { subjectCode: "HIST_I", groups: ["1A", "1B", "1C", "1D"], hours: 8 },
      { subjectCode: "INF", groups: ["1A", "1B", "1C", "1D", "2A", "2B", "2C", "2D", "3A", "3B", "3C", "3D"], hours: 24 },
      { subjectCode: "TUT", groups: ["3B"], hours: 1 },
    ],
  },
  {
    name: "Leidy Mariana",
    last_name: "Téllez Rangel",
    email: "leidy.tellez@sec47.edu.mx",
    phoneNumber: "7711234016",
    contractedHours: 37,
    assignments: [
      { subjectCode: "HIST_II", groups: ["2A", "2B", "2C", "2D"], hours: 16 },
      { subjectCode: "HIST_III", groups: ["3A", "3B", "3C", "3D"], hours: 16 },
      { subjectCode: "FCYE", groups: ["1B", "1C"], hours: 4 },
      { subjectCode: "TUT", groups: ["1B"], hours: 1 },
    ],
  },
  {
    name: "Obed",
    last_name: "Bautista Islas",
    email: "obed.bautista@sec47.edu.mx",
    phoneNumber: "7711234017",
    contractedHours: 15,
    assignments: [
      { subjectCode: "AM", groups: ["1D"], hours: 3 },
      { subjectCode: "AM", groups: ["3A", "3B", "3C", "3D"], hours: 12 },
    ],
  },
  {
    name: "Sergio",
    last_name: "Melo Fabela",
    email: "sergio.melo@sec47.edu.mx",
    phoneNumber: "7711234018",
    contractedHours: 19,
    assignments: [
      { subjectCode: "FIS", groups: ["2B", "2C", "2D"], hours: 18 },
      { subjectCode: "TUT", groups: ["2D"], hours: 1 },
    ],
  },
];

// Default password for all teachers
const DEFAULT_PASSWORD = "Sec47_2025!";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB\n");

    // 1. Create subjects
    console.log("=== Creating Subjects ===");
    const subjectMap = {};
    for (const sub of subjects) {
      const created = await Subject.findOneAndUpdate(
        { school: SCHOOL_ID, code: sub.code },
        { ...sub, school: SCHOOL_ID, isActive: true },
        { upsert: true, new: true }
      );
      subjectMap[sub.code] = created._id;
      console.log(`  ✓ ${sub.code}: ${sub.name}`);
    }

    // 2. Get all groups
    console.log("\n=== Loading Groups ===");
    const groups = await Group.find({ school: SCHOOL_ID, school_year_id: SCHOOL_YEAR_ID }).lean();
    const groupMap = {};
    for (const g of groups) {
      const key = `${g.grade}${g.section}`;
      groupMap[key] = g._id;
    }
    console.log(`  ✓ ${Object.keys(groupMap).length} groups loaded`);

    // 3. Create teachers and assignments
    console.log("\n=== Creating Teachers ===");
    const credentials = [];

    for (const teacher of teachers) {
      // Create user.
      // NOTA: findOneAndUpdate con upsert NO dispara el hook pre("save"),
      // por lo que el password se guardaría en texto plano y el login fallaría.
      // Se usa un find+set+save para que Mongoose hashee con bcrypt.
      const user = await User.findOne({ school: SCHOOL_ID, email: teacher.email });
      if (user) {
        user.school = SCHOOL_ID;
        user.name = teacher.name;
        user.last_name = teacher.last_name;
        user.email = teacher.email;
        user.phoneNumber = teacher.phoneNumber;
        if (!user.password || !user.password.startsWith("$2")) {
          user.password = DEFAULT_PASSWORD;
          user.markModified("password");
        }
        user.role = "teacher";
        user.isActive = true;
        user.contractedHours = teacher.contractedHours;
        user.appointmentType = "BASE";
        await user.save();
      } else {
        await User.create({
          school: SCHOOL_ID,
          name: teacher.name,
          last_name: teacher.last_name,
          email: teacher.email,
          phoneNumber: teacher.phoneNumber,
          password: DEFAULT_PASSWORD,
          role: "teacher",
          isActive: true,
          contractedHours: teacher.contractedHours,
          appointmentType: "BASE",
        });
      }
      console.log(`  ✓ ${teacher.name} ${teacher.last_name}`);

      // Create teacher-subject assignments
      for (const assignment of teacher.assignments) {
        const subjectId = subjectMap[assignment.subjectCode];
        if (!subjectId) {
          console.log(`    ⚠ Subject ${assignment.subjectCode} not found`);
          continue;
        }

        for (const groupKey of assignment.groups) {
          const groupId = groupMap[groupKey];
          if (!groupId) {
            console.log(`    ⚠ Group ${groupKey} not found`);
            continue;
          }

          await TeacherSubject.findOneAndUpdate(
            {
              school: SCHOOL_ID,
              teacher_id: user._id,
              subject_id: subjectId,
              group_id: groupId,
              school_year_id: SCHOOL_YEAR_ID,
            },
            {
              school: SCHOOL_ID,
              teacher_id: user._id,
              subject_id: subjectId,
              group_id: groupId,
              school_year_id: SCHOOL_YEAR_ID,
            },
            { upsert: true, new: true }
          );
        }
        console.log(`    → ${assignment.subjectCode} (${assignment.groups.join(", ")})`);
      }

      // Add to credentials
      credentials.push({
        name: `${teacher.name} ${teacher.last_name}`,
        email: teacher.email,
        password: DEFAULT_PASSWORD,
        phoneNumber: teacher.phoneNumber,
        role: "teacher",
        contractedHours: teacher.contractedHours,
      });
    }

    // 4. Generate credentials file
    console.log("\n=== Generating Credentials File ===");
    const credentialsPath = path.join(__dirname, "..", "credentials.md");
    let content = "# Teacher Credentials - Escuela Secundaria Técnica No. 47\n\n";
    content += "**Default Password:** `Sec47_2025!`\n\n";
    content += "| # | Name | Email | Phone | Hours |\n";
    content += "|---|------|-------|-------|-------|\n";

    credentials.forEach((cred, idx) => {
      content += `| ${idx + 1} | ${cred.name} | ${cred.email} | ${cred.phoneNumber} | ${cred.contractedHours} |\n`;
    });

    content += "\n---\n\n";
    content += "## Individual Credentials\n\n";
    credentials.forEach((cred) => {
      content += `### ${cred.name}\n`;
      content += `- **Email:** \`${cred.email}\`\n`;
      content += `- **Password:** \`${cred.password}\`\n`;
      content += `- **Phone:** ${cred.phoneNumber}\n`;
      content += `- **Role:** teacher\n`;
      content += `- **Contracted Hours:** ${cred.contractedHours}\n\n`;
    });

    fs.writeFileSync(credentialsPath, content);
    console.log(`  ✓ Credentials saved to: ${credentialsPath}`);

    console.log("\n=== Summary ===");
    console.log(`  Subjects created: ${subjects.length}`);
    console.log(`  Teachers created: ${teachers.length}`);
    console.log(`  Credentials file: credentials.md`);

    await mongoose.disconnect();
    console.log("\nDone!");
  } catch (error) {
    console.error("Error:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

run();
