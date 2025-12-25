const Message = require("../models/Message.js");

/* -------------------------------------------------
   SEND MESSAGE (HTTP ONLY)
--------------------------------------------------*/
const sendMessage = async (req, res) => {
  try {
    const sender = req.user._id;
    const receiver = req.params.userId || req.params.id;

    // 1. NOW ACCEPT 'iv' FROM FRONTEND
    const { content, iv } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message content is required",
      });
    }

    if (!iv) {
        // Security Check: If frontend forgets to encrypt, reject it.
        return res.status(400).json({
            success: false,
            message: "Encryption IV is missing. Secure message required.",
        });
    }

    // 2. SAVE MESSAGE WITH IV
    const message = await Message.create({
      sender,
      receiver,
      content,
      iv, // <--- CRITICAL: Save the randomness or decryption fails
      type: "text",
      status: "sent",
      isEncrypted: true, // <--- Encryption is now ACTIVE
    });

    // 3. SEND RESPONSE FAST (Don't wait for socket)
    res.status(201).json({
      success: true,
      message,
    });

    // 4. SOCKET EMIT (Background)
    const io = req.app.get("io");
    if (io) {
        io.to(receiver.toString()).emit("new_message", message);
        io.to(sender.toString()).emit("message_sent", message);
    }

  } catch (error) {
    console.error("Send message error:", error);
    // Safety check: Only send error if response wasn't sent
    if (!res.headersSent) {
        return res.status(500).json({
            success: false,
            message: "Failed to send message",
        });
    }
  }
};

/* -------------------------------------------------
   GET MESSAGES
--------------------------------------------------*/
const getMessages = async (req, res) => {
  try {
    const myId = req.user._id;
    const { userId } = req.params;
    const { limit = 20, cursor } = req.query;

    const query = {
      $or: [
        { sender: myId, receiver: userId },
        { sender: userId, receiver: myId },
      ],
    };

    if (cursor) {
      query._id = { $lt: cursor };
    }

    const messages = await Message.find(query)
      .sort({ _id: -1 })
      .limit(Number(limit));

    // Mark as seen (Only if fetching latest messages)
    if (!cursor) {
        await Message.updateMany(
            {
                sender: userId,
                receiver: myId,
                status: { $ne: "seen" },
            },
            { $set: { status: "seen" } }
        );
    }

    return res.json({
      success: true,
      messages: messages.reverse(),
      nextCursor: messages.length ? messages[0]._id : null,
    });

  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch messages",
    });
  }
};

module.exports = {
  sendMessage,
  getMessages,
};