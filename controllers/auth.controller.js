const jwt = require("jsonwebtoken"); // Firmador de JWT
const User = require("../models/User.model"); // Modelo de Usuario

const signupController = async (req, res, next) => { // POST /auth/signup
  try {
    const { name, email, password, role } = req.body; // Extraer campos

    const createdUser = await User.create({ name, email, password, role }); // Mongoose valida

    const authToken = jwt.sign( // Firmar token
      {
        _id: createdUser._id, // ID del usuario
        email: createdUser.email, // Email
        name: createdUser.name, // Nombre
        role: createdUser.role, // Rol para authorize()
      },
      process.env.SECRET_KEY, // Secreto HMAC
      { algorithm: "HS256", expiresIn: "8h" } // Expiración 8h
    );

    res.status(201).json({ // Respuesta 201 Created
      message: "User created successfully", // Mensaje
      user: { // Campos públicos
        _id: createdUser._id,
        email: createdUser.email,
        name: createdUser.name,
        role: createdUser.role,
      },
      authToken, // JWT
    });
  } catch (error) {
    next(error); // Propagar al manejador de errores
  }
};

const loginController = async (req, res, next) => { // POST /auth/login
  try {
    const { email, password } = req.body; // Extraer credenciales

    const foundUser = await User.findOne({ email }).select("+password"); // Incluir campo oculto
    if (!foundUser) { // No existe
      return res.status(404).json({ message: "Email is not registered." }); // 404
    }

    if (!foundUser.active) { // Cuenta desactivada
      return res
        .status(401)
        .json({ message: "This account is deactivated. Contact an admin." });
    }

    const isPasswordCorrect = await foundUser.comparePassword(password); // Comparar hash
    if (!isPasswordCorrect) { // Contraseña incorrecta
      return res.status(401).json({ message: "Incorrect password." }); // 401
    }

    const authToken = jwt.sign( // Firmar token
      {
        _id: foundUser._id, // ID del usuario
        email: foundUser.email, // Email
        name: foundUser.name, // Nombre
        role: foundUser.role, // Rol
      },
      process.env.SECRET_KEY, // Secreto HMAC
      { algorithm: "HS256", expiresIn: "8h" } // Expiración 8h
    );

    console.log(authToken); // obtenemos el token para verificar que se genera correctamente

    res.status(200).json({ authToken }); // Respuesta 200 OK
  } catch (error) {
    next(error); // Propagar
  }
};

const verifyController = (req, res, next) => { // GET /auth/verify
  try {
    res.status(200).json(req.payload); // Devolver JWT decodificado
  } catch (error) {
    next(error); // Propagar
  }
};

module.exports = { // Exportar
  signupController,
  loginController,
  verifyController,
};
