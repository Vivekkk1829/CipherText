const dotenv = require("dotenv");
dotenv.config();

const connectDB = require("./db/index.js");
const { Server } = require("socket.io");
const http = require("http");
const Message = require("./models/Message.js"); 
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

    // -------------------------------------------------
    // GLOBAL ONLINE USERS MAP 🌍
    // key = userId, value = socketId
    // -------------------------------------------------
    const userSocketMap = {}; 

    io.on("connection", (socket) => {
      console.log("Socket Connected", socket.id);

      const userId = socket.handshake.auth?.userId;

      if (userId) {
        // 1. Add User to Map
        userSocketMap[userId] = socket.id;
        
        // 2. Add User to their own Room (for private msgs)
        socket.join(userId.toString());
        
        // 3. BROADCAST ONLINE USERS TO EVERYONE 🟢
        io.emit("get_online_users", Object.keys(userSocketMap));
        
        console.log(`User ${userId} joined room`);
      }

      /* -------------------------------------------------
         1. HANDLE "DELIVERED"
      --------------------------------------------------*/
      socket.on("mark_delivered", async ({ messageId, senderId }) => {
        try {
          await Message.updateOne(
            { _id: messageId, status: "sent" }, 
            { $set: { status: "delivered" } }
          );

          io.to(senderId).emit("message_status_update", {
            messageId,
            status: "delivered",
          });
        } catch (error) {
          console.error("Error marking delivered:", error);
        }
      });

      /* -------------------------------------------------
         2. HANDLE "SEEN"
      --------------------------------------------------*/
      socket.on("mark_seen", async ({ senderId, receiverId }) => {
        try {
          await Message.updateMany(
            { 
              sender: senderId, 
              receiver: receiverId, 
              status: { $ne: "seen" } 
            }, 
            { $set: { status: "seen" } }
          );

          io.to(senderId).emit("messages_seen_update", {
            conversationId: receiverId, 
            status: "seen"
          });
          
        } catch (error) {
          console.error("Error marking seen:", error);
        }
      });

      /* -------------------------------------------------
         3. HANDLE TYPING STATUS ✍️ (NEW BLOCK)
      --------------------------------------------------*/
      socket.on("typing", ({ senderId, receiverId }) => {
        // Broadcast specifically to the receiver
        io.to(receiverId).emit("user_typing", { senderId });
      });

      socket.on("stop_typing", ({ senderId, receiverId }) => {
        io.to(receiverId).emit("user_stopped_typing", { senderId });
      });

      // -------------------------------------------------
      // HANDLE DISCONNECT 🔴
      // -------------------------------------------------
      socket.on("disconnect", () => {
        console.log("Socket Disconnected", socket.id);
        if (userId) {
            delete userSocketMap[userId];
            // Broadcast the updated list to everyone
            io.emit("get_online_users", Object.keys(userSocketMap));
        }
      });
    });

    server.listen(process.env.PORT || 8000, () => {
      console.log(`App running successfully on PORT ${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.log("MongoDB connection failed!!", err);
  });