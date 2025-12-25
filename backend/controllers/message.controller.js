const Message = require("../models/Message.js");

/* -------------------------------------------------
   SEND MESSAGE (HTTP ONLY)
--------------------------------------------------*/
const sendMessage = async (req, res) => {
  try {

    const sender = req.user._id;
    const receiver = req.params.userId || req.params.id;

    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message content is required",
      });
    }

    const message = await Message.create({
      sender,
      receiver,
      content,
      type: "text",
      status: "sent",
      isEncrypted: false,
    });

    const io = req.app.get("io");
    io.to(receiver.toString()).emit("new_message", message);
    io.to(sender.toString()).emit("message_sent", message);

    return res.status(201).json({
      success: true,
      message,
    });

  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send message",
    });
  }
};

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

    // cursor-based pagination
    if (cursor) {
      query._id = { $lt: cursor };
    }

    const messages = await Message.find(query)
      .sort({ _id: -1 })
      .limit(Number(limit));

    // mark incoming messages as seen
    await Message.updateMany(
      {
        sender: userId,
        receiver: myId,
        status: { $ne: "seen" },
      },
      { $set: { status: "seen" } }
    );

    

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
