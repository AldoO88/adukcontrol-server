// Conexión a MongoDB
// Al importar este módulo, se inicia el intento de conexión.
// Si falla, el proceso se cierra con código 1.
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/eduk_control";

mongoose
  .connect(MONGO_URI)
  .then((x) => {
    // Conexión exitosa: loggear el nombre de la base para confirmar
    const dbName = x.connections[0].name;
    console.log(`Connected to Mongo! Database name: "${dbName}"`);
  })
  .catch((err) => {
    // Conexión fallida: registrar y abortar el proceso
    console.error("Error connecting to mongo: ", err);
    process.exit(1);
  });
