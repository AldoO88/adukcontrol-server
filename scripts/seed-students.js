// Script to create students and guardians for testing
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const School = require("../models/School.model");
const SchoolYear = require("../models/SchoolYear.model");
const Group = require("../models/Group.model");
const Student = require("../models/Student.model");
const Enrollment = require("../models/Enrollment.model");
const User = require("../models/User.model");
const Guardian = require("../models/Guardian.model");

const SCHOOL_ID = "6a790cb141b48704e7d2d72e";
const SCHOOL_YEAR_ID = "6a790cb141b48704e7d2d735";

// Mexican names for students
const firstNamesMale = [
  "Santiago", "Mateo", "Sebastián", "Daniel", "Carlos", "Andrés", "Diego", "Javier",
  "Miguel", "Alejandro", "Luis", "Antonio", "José", "Marco", "Fernando", "Ricardo",
  "Jorge", "Eduardo", "Rafael", "Pedro", "Arturo", "Roberto", "Sergio", "Vicente",
  "Francisco", "Emilio", "Raúl", "Óscar", "Germán", "Héctor", "Ignacio", "Tomás",
  "Adrián", "Leonardo", "Pablo"
];

const firstNamesFemale = [
  "María", "Sofía", "Valentina", "Camila", "Ximena", "Regina", "Ana", "Daniela",
  "Victoria", "Lucía", "Fernanda", "Alejandra", "Paulette", "Mariana", "Andrea",
  "Gabriela", "Laura", "Mónica", "Claudia", "Patricia", "Elena", "Rosa", "Carmen",
  "Teresa", "Isabel", "Beatriz", "Alicia", "Sandra", "Leticia", "Adriana",
  "Verónica", "Aurora", "Rocío", "Diana", "Carolina"
];

const lastNames = [
  "García", "Hernández", "López", "Martínez", "González", "Rodríguez", "Pérez",
  "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez", "Díaz", "Cruz",
  "Morales", "Reyes", "Gutiérrez", "Ortiz", "Ruiz", "Vargas", "Castillo",
  "Jiménez", "Moreno", "Romero", "Herrera", "Medina", "Aguilar", "Vega", "Castro"
];

// CURP parts for generating fake CURPs
const curpStates = ["HGO", "MEX", "PUE", "TLA", "VER", "OAX", "GUE", "MIC"];
const curpVowels = "AEIOU";
const curpConsonants = "BCDFGHJKLMNPQRSTVWXYZ";

// Guardians for testing
const guardians = [
  {
    name: "Roberto",
    last_name: "García López",
    email: "roberto.garcia@test.com",
    phoneNumber: "7711111111",
    password: "Test1234!",
    studentCount: 2, // This guardian will have 2 students
  },
  {
    name: "María Elena",
    last_name: "Hernández Ruiz",
    email: "maria.hernandez@test.com",
    phoneNumber: "7711111122",
    password: "Test1234!",
    studentCount: 1,
  },
  {
    name: "Francisco Javier",
    last_name: "Martínez Gómez",
    email: "francisco.martinez@test.com",
    phoneNumber: "7711111133",
    password: "Test1234!",
    studentCount: 1,
  },
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCURP(firstName, lastName1, lastName2, gender) {
  // CURP format (18 chars): 
  // 3 letters (first consonant of last1, first vowel of last1, first consonant of last2)
  // + 1 letter (first of name)
  // + 2 digits (year of birth)
  // + 2 digits (month)
  // + 2 digits (day)
  // + 1 letter (H/M for gender)
  // + 2 letters (state code)
  // + 3 consonants (internal)
  // + 1 letter (check)
  // + 1 letter (year digit)
  // + 1 letter (random)
  
  //简化版 para testing
  const l1 = lastName1.toUpperCase().replace(/[^A-Z]/g, "");
  const l2 = lastName2.toUpperCase().replace(/[^A-Z]/g, "");
  const n = firstName.toUpperCase().replace(/[^A-Z]/g, "");
  
  // First consonant of last1
  const c1 = l1.split("").find(c => !curpVowels.includes(c)) || "X";
  // First vowel of last1
  const v1 = l1.split("").find(c => curpVowels.includes(c)) || "X";
  // First consonant of last2
  const c2 = l2.split("").find(c => !curpVowels.includes(c)) || "X";
  // First letter of name
  const nameL = n[0] || "X";
  
  // Random year (2008-2012 for secondary students)
  const year = String(Math.floor(Math.random() * 5) + 8); // 08-12
  
  // Random month (01-12)
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  
  // Random day (01-28)
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, "0");
  
  // Gender: H = male, M = female
  const genderChar = gender === "M" ? "H" : "M";
  
  // Random state (2 letters)
  const state1 = curpConsonants[Math.floor(Math.random() * curpConsonants.length)];
  const state2 = curpConsonants[Math.floor(Math.random() * curpConsonants.length)];
  
  // Internal consonants (3)
  const int1 = curpConsonants[Math.floor(Math.random() * curpConsonants.length)];
  const int2 = curpConsonants[Math.floor(Math.random() * curpConsonants.length)];
  const int3 = curpConsonants[Math.floor(Math.random() * curpConsonants.length)];
  
  // Check letter
  const check = curpConsonants[Math.floor(Math.random() * curpConsonants.length)];
  
  // Year digit and random
  const yearDigit = String(Math.floor(Math.random() * 10));
  const rand = curpConsonants[Math.floor(Math.random() * curpConsonants.length)];
  
  // Build CURP: C1V1C2 + NAME + YYMMDD + GENDER + STATE + INTERNAL + CHECK + YEARDIGIT + RAND
  // = 3 + 1 + 2 + 2 + 2 + 1 + 2 + 3 + 1 + 1 + 1 = 19 chars... need to adjust
  
  // Simpler: 18 chars total
  // First 4: consonant, vowel, consonant (from last names), first letter of name
  const first4 = `${c1}${v1}${c2}${nameL}`;
  
  // Next 6: YYMMDD
  const date6 = `${year}${month}${day}`;
  
  // Next 1: gender
  const g1 = genderChar;
  
  // Next 2: state (2 consonants)
  const s2 = `${state1}${state2}`;
  
  // Next 3: internal consonants
  const i3 = `${int1}${int2}${int3}`;
  
  // Last 2: check + random
  const last2 = `${check}${rand}`;
  
  const curp = `${first4}${date6}${g1}${s2}${i3}${last2}`;
  
  // Ensure exactly 18 chars
  return curp.slice(0, 18).padEnd(18, "X");
}

function generateControlNumber(grade, section, index) {
  const year = "25";
  const gradeChar = grade.toString();
  const sectionChar = section;
  const consec = index.toString().padStart(3, "0");
  return `${year}${gradeChar}${sectionChar}${consec}`;
}

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB\n");

    // 1. Get all groups
    const groups = await Group.find({
      school: SCHOOL_ID,
      school_year_id: SCHOOL_YEAR_ID,
    }).lean();

    console.log("=== Groups ===");
    console.log("Total groups:", groups.length);

    // 2. Create students for each group
    console.log("\n=== Creating Students ===");
    let totalStudents = 0;
    const allStudents = []; // Store for guardian assignment

    for (const group of groups) {
      const groupLabel = `${group.grade}°${group.section}`;
      console.log(`\n${groupLabel}:`);

      for (let i = 1; i <= 35; i++) {
        const gender = Math.random() > 0.5 ? "M" : "F";
        const firstName = gender === "M" ? randomItem(firstNamesMale) : randomItem(firstNamesFemale);
        const lastName1 = randomItem(lastNames);
        const lastName2 = randomItem(lastNames);

        const curp = generateCURP(firstName, lastName1, lastName2, gender);

        // Create student with current_group_id so pre-save can generate controlNumber
        const student = await Student.create({
          school: SCHOOL_ID,
          first_name: firstName,
          last_name: `${lastName1} ${lastName2}`,
          curp,
          current_group_id: group._id,
          status: "active",
          rfid_card: `CARD${String(i).padStart(4, "0")}${group.grade}${group.section}`,
        });

        // Create enrollment
        await Enrollment.create({
          school: SCHOOL_ID,
          school_year_id: SCHOOL_YEAR_ID,
          student_id: student._id,
          group_id: group._id,
          cycle_status: "enrolled",
          enrollment_number: student.controlNumber,
        });

        totalStudents++;
        allStudents.push({
          _id: student._id,
          name: `${firstName} ${lastName1} ${lastName2}`,
          group: groupLabel,
          controlNumber: student.controlNumber,
        });

        if (i % 10 === 0 || i === 35) {
          process.stdout.write(`  ✓ ${i}/35`);
        }
      }
      console.log(" done");
    }

    console.log(`\nTotal students created: ${totalStudents}`);

    // 3. Create guardians
    console.log("\n=== Creating Guardians ===");

    // Get first students for guardian assignment
    const allStudentsList = [...allStudents];

    const guardianDocs = [];
    let studentIndex = 0;

    for (const g of guardians) {
      // Get students for this guardian
      const assignedStudents = [];
      for (let i = 0; i < g.studentCount; i++) {
        if (studentIndex < allStudentsList.length) {
          assignedStudents.push(allStudentsList[studentIndex]);
          studentIndex++;
        }
      }

      // Create guardian record
      const guardian = await Guardian.create({
        school: SCHOOL_ID,
        name: `${g.name} ${g.last_name}`,
        phone: g.phoneNumber,
        relationship: "parent",
        students: assignedStudents.map((s) => s._id),
        user_id: null, // Will be linked when user activates
      });

      // Create user
      const user = await User.create({
        school: SCHOOL_ID,
        name: g.name,
        last_name: g.last_name,
        email: g.email,
        phoneNumber: g.phoneNumber,
        password: g.password,
        role: "tutor",
        isActive: true,
      });

      // Link user to guardian
      guardian.user_id = user._id;
      await guardian.save();

      // Update students with guardian reference
      for (const student of assignedStudents) {
        await Student.findByIdAndUpdate(student._id, {
          $push: { guardians: guardian._id },
        });
      }

      console.log(`\n${g.name} ${g.last_name}:`);
      console.log(`  Email: ${g.email}`);
      console.log(`  Phone: ${g.phoneNumber}`);
      console.log(`  Password: ${g.password}`);
      for (const s of assignedStudents) {
        console.log(`  → Student: ${s.name} (${s.group}) - Control: ${s.controlNumber}`);
      }

      guardianDocs.push({
        name: `${g.name} ${g.last_name}`,
        email: g.email,
        phone: g.phoneNumber,
        password: g.password,
        students: assignedStudents.map((s) => ({
          name: s.name,
          group: s.group,
          controlNumber: s.controlNumber,
        })),
      });
    }

    // 4. Generate credentials file
    console.log("\n=== Generating Credentials File ===");
    const credentialsPath = path.join(__dirname, "..", "credentials.md");

    let content = fs.readFileSync(credentialsPath, "utf8");

    // Add students section
    content += "\n---\n\n";
    content += "# Students and Guardians - Test Credentials\n\n";
    content += "**Note:** Only 3 guardians created for testing. 35 students per group.\n\n";

    content += "## Guardians (Tutors)\n\n";
    content += "| Name | Email | Phone | Password | Students |\n";
    content += "|------|-------|-------|----------|----------|\n";

    for (const g of guardianDocs) {
      const studentNames = g.students.map((s) => `${s.name} (${s.group})`).join(", ");
      content += `| ${g.name} | ${g.email} | ${g.phone} | \`${g.password}\` | ${studentNames} |\n`;
    }

    content += "\n### Guardian Details\n\n";
    for (const g of guardianDocs) {
      content += `#### ${g.name}\n`;
      content += `- **Email:** \`${g.email}\`\n`;
      content += `- **Phone:** ${g.phone}\n`;
      content += `- **Password:** \`${g.password}\`\n`;
      content += `- **Role:** tutor\n`;
      content += `- **Students:**\n`;
      for (const s of g.students) {
        content += `  - ${s.name} - ${s.group} (${s.controlNumber})\n`;
      }
      content += "\n";
    }

    // Add student summary
    content += "## Students Summary\n\n";
    content += "| Group | Students | Control Numbers |\n";
    content += "|-------|----------|------------------|\n";

    for (const group of groups) {
      const groupLabel = `${group.grade}°${group.section}`;
      const groupStudents = allStudents.filter((s) => s.group === groupLabel);
      const controlRange = `${groupStudents[0]?.controlNumber || "N/A"} - ${groupStudents[groupStudents.length - 1]?.controlNumber || "N/A"}`;
      content += `| ${groupLabel} | ${groupStudents.length} | ${controlRange} |\n`;
    }

    content += `\n**Total Students:** ${totalStudents}\n`;

    fs.writeFileSync(credentialsPath, content);
    console.log(`  ✓ Credentials appended to: ${credentialsPath}`);

    // 5. Summary
    console.log("\n=== Summary ===");
    console.log("Students created:", totalStudents);
    console.log("Guardians created:", guardians.length);
    console.log("Students per group: 35");
    console.log("Guardian with 2 students:", guardians[0].name);

    await mongoose.disconnect();
    console.log("\nDone!");
  } catch (error) {
    console.error("Error:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

run();
