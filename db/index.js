const mongoose = require("mongoose"); // ODM para MongoDB

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/eduk_control"; // URI de conexión

mongoose // Iniciar la conexión
  .connect(MONGO_URI) // Promesa que resuelve al conectar
  .then((x) => { // Al conectar exitosamente
    const dbName = x.connections[0].name; // Extraer nombre de la base
    console.log(`Connected to Mongo! Database name: "${dbName}"`); // Confirmar
  })
  .catch((err) => { // Al fallar la conexión
    console.error("Error connecting to mongo: ", err); // Registrar el error
    process.exit(1); // Fallar rápido
  });
