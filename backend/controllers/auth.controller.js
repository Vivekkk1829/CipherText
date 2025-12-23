const User = require("../models/User.js");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken")

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
      res.status(404).json({
        success: false,
        message: "User doesnot Exist",
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
        id: checkUser._id,
        email: checkUser.email,
        userName: checkUser.userName,
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

const registerUser = async (req, res) => {
  try {
    const { userName, email, password } = req.body;
    if (!userName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }
    const checkName = await User.findOne({ userName });
    if (checkName) {
      return res.status(409).json({
        success: false,
        message: "userName already exists",
      });
    }
    const checkEmail = await User.findOne({ email });
    if (checkEmail) {
      return res.status(409).json({
        success: false,
        message: "email already exists",
      });
    }
    const hashPassword = await bcrypt.hash(password, 10);

    const newUser = User.create({
      userName,
      email,
      password: hashPassword,
    });

    res.status(200).json({
      success: true,
      message: "Registration Sucessfull",
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Registration failed",
    });
  }
};

module.exports = { loginUser, registerUser };
