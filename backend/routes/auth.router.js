const express = require("express");
const router = express.Router();
const {
  loginUser,
  registerUser,
} = require("../controllers/auth.controller.js");
const authMiddleware = require("../middlewares/auth.middleware.js");

router.post("/login", loginUser);
router.post("/register", registerUser);
router.get("/me", authMiddleware, (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  });
});

module.exports = router;
