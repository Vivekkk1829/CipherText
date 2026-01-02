const Message = require("../models/Message.js");
const Conversation = require("../models/Conversation.js");
const getConversationId = require("../utils/getConversationId.js");

/* -------------------------------------------------
   SEND MESSAGE (Updates Server ID & Client ID)
--------------------------------------------------*/
const sendMessage = async (req, res) => {
  try {
    const sender = req.user._id.toString();
    const receiver = req.params.userId || req.params.id;
    const { content, iv, clientSeq } = req.body;

    // if (Number(clientSeq) % 10 === 0) {
    //   console.log(`🐢 Simulating lag for message #${clientSeq}...`);
    //   await new Promise((resolve) => setTimeout(resolve, 10000));
    // }

    if (!content || !iv || clientSeq === undefined) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }

    const customConversationId = getConversationId(sender, receiver);

    // 1. UPDATE CONVERSATION STATE
    // - Increment Server ID (+1)
    // - Update Sender's Client ID (to whatever you sent, e.g., 501)
    const conversation = await Conversation.findOneAndUpdate(
      { conversationId: customConversationId },
      {
        $setOnInsert: { conversationId: customConversationId },
        $inc: { lastSequenceId: 1 }, // Server Logic (1000 -> 1001)
        $set: { [`participantCounters.${sender}`]: Number(clientSeq) }, // Client Logic (500 -> 501)
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // 2. SAVE MESSAGE
    const message = await Message.create({
      conversationId: conversation._id,
      sender,
      receiver,
      content,
      iv,
      sequenceId: conversation.lastSequenceId, // Server ID (e.g., 1001)
      clientSeq: Number(clientSeq), // Client ID (e.g., 501)
      type: "text",
      status: "sent",
      isEncrypted: true,
    });

    await Conversation.findByIdAndUpdate(conversation._id, {
      lastMessage: message._id,
    });

    res.status(201).json({ success: true, message });

    const io = req.app.get("io");
    if (io) {
      io.to(receiver.toString()).emit("new_message", message);
      io.to(sender.toString()).emit("message_sent", message);
    }
  } catch (error) {
    console.error("Send message error:", error);
    if (!res.headersSent)
      return res.status(500).json({ success: false, message: "Failed" });
  }
};

/* -------------------------------------------------
   GET MESSAGES (Returns Client Sequences)
--------------------------------------------------*/
const getMessages = async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const userId = req.params.userId || req.params.id;
    const { limit = 20, cursor } = req.query;

    const customConversationId = getConversationId(myId, userId);

    const conversation = await Conversation.findOne({
      conversationId: customConversationId,
    });

    if (!conversation) {
      console.log("❌ Conversation Document NOT Found");
      return res.status(200).json({
        success: true,
        messages: [],
        lastServerSeq: 0,
        myLastClientSeq: 0,
        theirLastClientSeq: 0,
      });
    }

    // ---------------------------------------------------------
    // 🔥 EXTRACT THE CLIENT SEQUENCES
    // ---------------------------------------------------------
    // 1. My Last Seq: So I know to send (501 + 1) = 502 next.
    const myLastClientSeq = conversation.participantCounters
      ? conversation.participantCounters.get(myId) || 0
      : 0;

    // 2. Their Last Seq: So I know if I should wait for a missing message.
    const theirLastClientSeq = conversation.participantCounters
      ? conversation.participantCounters.get(userId) || 0
      : 0;

    // Standard "Mark as Seen"
    if (!cursor) {
      const updateResult = await Message.updateMany(
        {
          conversationId: conversation._id,
          sender: userId,
          status: { $ne: "seen" },
        },
        { $set: { status: "seen" } }
      );
      if (updateResult.modifiedCount > 0) {
        const io = req.app.get("io");
        if (io)
          io.to(userId.toString()).emit("messages_seen_update", {
            conversationId: myId,
            status: "seen",
          });
      }
    }

    // Fetch Messages
    let query = { conversationId: conversation._id };
    if (cursor) query._id = { $lt: cursor };

    const messages = await Message.find(query)
      .sort({ sequenceId: -1 })
      .limit(Number(limit));

    return res.json({
      success: true,
      messages: messages.reverse(),
      nextCursor: messages.length ? messages[0]._id : null,

      // ✅ RETURN ALL 3 CRITICAL NUMBERS
      lastServerSeq: conversation.lastSequenceId,
      myLastClientSeq: myLastClientSeq,
      theirLastClientSeq: theirLastClientSeq,
    });
  } catch (error) {
    console.error("Get messages error:", error);
    return res.status(500).json({ success: false, message: "Failed" });
  }
};

module.exports = { sendMessage, getMessages };
