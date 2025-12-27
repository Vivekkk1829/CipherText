const Message = require("../models/Message.js");

/* -------------------------------------------------
   SEND MESSAGE
--------------------------------------------------*/
const sendMessage = async (req, res) => {
  try {
    const sender = req.user._id;
    // Safety Check: Handle both :id and :userId param names
    const receiver = req.params.userId || req.params.id;
    const { content, iv } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: "Message content is required" });
    }

    if (!iv) {
        return res.status(400).json({ success: false, message: "Encryption IV is missing." });
    }

    const message = await Message.create({
      sender,
      receiver,
      content,
      iv,
      type: "text",
      status: "sent",
      isEncrypted: true,
    });

    res.status(201).json({ success: true, message });

    const io = req.app.get("io");
    if (io) {
        // Emit to Receiver (User B)
        io.to(receiver.toString()).emit("new_message", message);
        // Emit to Sender (User A)
        io.to(sender.toString()).emit("message_sent", message);
    }

  } catch (error) {
    console.error("Send message error:", error);
    if (!res.headersSent) return res.status(500).json({ success: false, message: "Failed to send message" });
  }
};

/* -------------------------------------------------
   GET MESSAGES
--------------------------------------------------*/
const getMessages = async (req, res) => {
  try {
    const myId = req.user._id;
    // FIX: Standardize ID extraction like in sendMessage
    const userId = req.params.userId || req.params.id;
    const { limit = 20, cursor } = req.query;

    // ---------------------------------------------------------
    // STEP 1: MARK AS SEEN (On Load)
    // ---------------------------------------------------------
    // If loading the chat for the first time (no cursor), mark unread messages as seen.
    if (!cursor) {
        const updateResult = await Message.updateMany(
            {
                sender: userId, // Sent BY the other person
                receiver: myId, // To ME
                status: { $ne: "seen" }, // Not yet seen
            },
            { $set: { status: "seen" } }
        );

        // Notify the Sender (User A) instantly via Socket
        if (updateResult.modifiedCount > 0) {
            const io = req.app.get("io");
            if (io) {
                io.to(userId.toString()).emit("messages_seen_update", {
                    conversationId: myId, 
                    status: "seen"
                });
            }
        }
    }

    // ---------------------------------------------------------
    // STEP 2: FETCH MESSAGES
    // ---------------------------------------------------------
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

    return res.json({
      success: true,
      messages: messages.reverse(),
      nextCursor: messages.length ? messages[0]._id : null,
    });

  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch messages" });
  }
};

module.exports = {
  sendMessage,
  getMessages,
};