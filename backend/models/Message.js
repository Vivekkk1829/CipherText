const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    content: { type: String, required: true },
    iv: { type: String, required: true },
    
    // 🔢 SERVER ID (Global Order)
    // Assigned by Server. Example: 1000, 1001
    sequenceId: {
      type: Number,
      required: true, 
    },

    // 🏷️ CLIENT ID (Sender's Order)
    // Sent by User A. Example: 500, 501
    // User B uses this to detect gaps ("I got 501 but missed 500!")
    clientSeq: {
      type: Number,
      required: true, 
    },

    type: { type: String, default: "text" },
    status: { type: String, default: "sent" },
    isEncrypted: { type: Boolean, default: true },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, sequenceId: 1 });

module.exports = mongoose.model("Message", messageSchema);