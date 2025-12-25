const dotenv = require("dotenv");
const connectDB = require("./db/index.js");
const { Server } = require("socket.io");
const http = require("http");
dotenv.config();
const app = require("./app.js");

connectDB()
  .then(() => {
    const server = http.createServer(app);

    const io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL,
        credentials: true,
      },
    });
    app.set("io", io);
    io.on("connect", (socket) => {
      console.log("Socket Connected", socket.id);

      const userId = socket.handshake.auth?.userId;

      if (userId) {
        socket.join(userId.toString());
        console.log(`User ${userId} joined room`);
      }

      socket.on("disconnect", () => {
        console.log("Socket Disconnected", socket.id);
      });
    });
    server.listen(process.env.PORT || 8000, () => {
      console.log(`App running sucessfully on PORT ${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.log("MongoDB connection failed!!", err);
  });
