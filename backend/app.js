const express = require("express");
const app = express();
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRouter = require("./routes/auth.router.js");
const getUserRouter = require("./routes/getUsers.router.js");
const messageRouter = require("./routes/message.route.js");

app.use(cookieParser());

app.use(
  cors({
    origin: process.env.FRONTEND_URL, 
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.use("/api/auth", authRouter);
app.use("/api", getUserRouter);
app.use("/api/messages", messageRouter);

module.exports = app;
