const Message = require("../models/Message");
const Counter = require("../models/Counter");
// ⚠️ CHECK: Make sure this filename matches exactly what you created (redisScript.js vs redisScripts.js)
const getConversationId = require("../utils/conversationId");
const LUA_SCRIPT = require("../utils/redisScripts"); 
const redis = require("../db/redis"); // ✅ Using Cloud Connection

/* ----------------------------------------------------------------
   HELPER: PROCESS & SAVE
   This handles the "DB Write" part.
---------------------------------------------------------------- */
async function processMessage(payload, io) {
    const { sender, receiver, content, iv, clientId, clientUuid } = payload;

    // 1. Generate Strict Conversation ID
    const conversationId = getConversationId(sender, receiver);

    // 2. Generate Global Sequence ID (Atomic Increment)
    const counter = await Counter.findByIdAndUpdate(
        conversationId,
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    const globalSequenceId = counter.seq;

    try {
        // 3. Save to MongoDB
        const message = await Message.create({
            sender,
            receiver,
            content,
            iv,
            clientId,        // Client Input Order
            clientUuid,      // Client Session
            conversationId,  // Grouping Key
            sequenceId: globalSequenceId, // Server Output Order
            type: "text",
            status: "sent"
        });

        // 4. Emit to Socket (Real-time)
        if (io) {
            io.to(receiver.toString()).emit("new_message", message);
            io.to(sender.toString()).emit("message_sent", message);
        }

        return message;
    } catch (error) {
        if (error.code === 11000) {
            console.log("Duplicate caught by DB index.");
            return await Message.findOne({ conversationId, clientUuid, clientId });
        }
        throw error;
    }
}

/* ----------------------------------------------------------------
   HELPER: CHECK BUFFER (Background Task)
---------------------------------------------------------------- */
async function checkBuffer(receiverId, senderId, io) {
    const seqKey = `sess:seq:${receiverId}:${senderId}`;
    const bufferKey = `sess:buf:${receiverId}:${senderId}`;

    try {
        while (true) {
            const expectedId = await redis.get(seqKey);
            const buffered = await redis.zrangebyscore(bufferKey, expectedId, expectedId);

            if (buffered.length > 0) {
                // 🟢 LOG FOR CHAOS TEST
                console.log(`[BUFFER] 🔧 Found missing message #${expectedId}. Processing now...`);
                
                const payload = JSON.parse(buffered[0]);
                await processMessage(payload, io);

                await redis.zrem(bufferKey, buffered[0]);
                await redis.incr(seqKey);
            } else {
                break; 
            }
        }
    } catch (error) {
        console.error("Error in background buffer check:", error);
    }
}

/* ----------------------------------------------------------------
   MAIN API: SEND MESSAGE
---------------------------------------------------------------- */
const sendMessage = async (req, res) => {
  try {
    const sender = req.user._id.toString();
    const receiver = req.params.userId || req.params.id;
    const { content, iv, clientId, clientUuid } = req.body;

    if (!clientId || !clientUuid) {
        return res.status(400).json({ success: false, message: "Missing Ordering IDs" });
    }

    const io = req.app.get("io");

    const uuidKey = `sess:uuid:${receiver}:${sender}`;
    const seqKey = `sess:seq:${receiver}:${sender}`;
    const bufferKey = `sess:buf:${receiver}:${sender}`;
    
    const payload = { sender, receiver, content, iv, clientId, clientUuid };
    const payloadString = JSON.stringify(payload);

    // 🚀 EXECUTE LUA SCRIPT
    const result = await redis.eval(LUA_SCRIPT, 3, uuidKey, seqKey, bufferKey, clientUuid, clientId, payloadString);
    const status = result[0]; 

    if (status === 1) {
        // CASE A: Immediate
        // 🟢 LOG FOR CHAOS TEST
        console.log(`[ORDERING] ✅ Processing Message #${clientId} immediately.`);
        
        const message = await processMessage(payload, io);
        checkBuffer(receiver, sender, io); 
        return res.status(201).json({ success: true, message });

    } else if (status === 2) {
        // CASE B: Buffered
        // 🟢 LOG FOR CHAOS TEST (This proves it works!)
        console.log(`[ORDERING] ⏳ Message #${clientId} arrived too early. Buffered in Redis.`);
        
        return res.status(200).json({ success: true, status: "buffered" });

    } else {
        // CASE C: Ignored
        // 🟢 LOG FOR CHAOS TEST
        console.log(`[ORDERING] 🗑️ Message #${clientId} was a duplicate/old. Ignored.`);
        
        return res.status(200).json({ success: true, status: "ignored" });
    }

  } catch (error) {
    console.error("Send Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

/* ----------------------------------------------------------------
   MAIN API: GET MESSAGES
---------------------------------------------------------------- */
const getMessages = async (req, res) => {
  try {
  const  userToChatId  = req.params.userId || req.params.id;
    const senderId = req.user._id;

    // console.log("---------------- DEBUG ----------------");
    // console.log("Sender ID (req.user._id):", senderId);
    // console.log("Receiver ID (req.params.id):", userToChatId);
    // console.log("---------------------------------------");

    // 1. Get Conversation ID
    const conversationId = getConversationId(senderId, userToChatId);

    // 2. Pagination
    const cursor = req.query.cursor ? Number(req.query.cursor) : null;
    const limit = 20;

    let query = { conversationId };
    if (cursor) {
      query.sequenceId = { $lt: cursor };
    }

    // 3. Fetch (Sorted by Sequence)
    const messages = await Message.find(query)
      .sort({ sequenceId: -1 }) 
      .limit(limit);

    const nextCursor = messages.length > 0 ? messages[messages.length - 1].sequenceId : null;

    res.status(200).json({ 
        messages: messages.reverse(), 
        nextCursor 
    });

  } catch (error) {
    console.error("Get Messages Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { sendMessage, getMessages };