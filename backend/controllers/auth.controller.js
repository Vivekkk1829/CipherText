const User = require("../models/User.js");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");


const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const checkUser = await User.findOne({ email });
    if (!checkUser) {
      return res.status(404).json({
        success: false,
        message: "User does not exist",
      });
    }

    const isPasswordMatch = await bcrypt.compare(password, checkUser.password);
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    const token = jwt.sign(
      {
        id: checkUser._id,
        email: checkUser.email,
        userName: checkUser.userName,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: true, 
      sameSite: "none",
      maxAge: 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: {
        _id: checkUser._id, // Standardize on _id usually, but id is fine too
        id: checkUser._id,
        email: checkUser.email,
        userName: checkUser.userName,
        publicKey: checkUser.publicKey, 
        encryptedPrivateKey: checkUser.encryptedPrivateKey, // Sending the vault back to client
      },
    });

  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Login Failed",
    });
  }
};

/* -------------------------------------------------
   REGISTER USER
   Now accepts: publicKey + encryptedPrivateKey
--------------------------------------------------*/
const registerUser = async (req, res) => {
  try {
    // 1. Accept keys from Frontend
    const { userName, email, password, publicKey, encryptedPrivateKey } = req.body;

    // 2. Validate all fields
    if (!userName || !email || !password || !publicKey || !encryptedPrivateKey) {
      return res.status(400).json({
        success: false,
        message: "All fields are required (including Security Keys)",
      });
    }

    const checkName = await User.findOne({ userName });
    if (checkName) {
      return res.status(409).json({ success: false, message: "userName already exists" });
    }

    const checkEmail = await User.findOne({ email });
    if (checkEmail) {
      return res.status(409).json({ success: false, message: "email already exists" });
    }

    const hashPassword = await bcrypt.hash(password, 10);

    // 3. Save User with the Keys
    const newUser = await User.create({
      userName,
      email,
      password: hashPassword,
      publicKey,              // Public Identity
      encryptedPrivateKey,    // The Locked Vault
    });

    // Optional: Auto-login after register? 
    // For now, we just return success.
    res.status(201).json({
      success: true,
      message: "Registration Successful",
    });

  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Registration failed",
    });
  }
};

const logoutUser = async (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
  });
  return res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
};

module.exports = { loginUser, registerUser, logoutUser };