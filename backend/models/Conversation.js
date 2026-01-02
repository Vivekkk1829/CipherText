const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    // 🔥 UNIQUE ID: "userA_userB"
    conversationId: {
      type: String,
      required: true,
      unique: true,
    },

    // 🔢 GLOBAL TICKET MACHINE
    // The highest sequence number in this chat (e.g., 50)
    lastSequenceId: {
      type: Number,
      default: 0,
    },

    // 🔖 CLIENT-SIDE COUNTERS
    // Stores the last sequence ID specific users have sent/seen.
    // Example: { "65df...": 20, "65ea...": 19 }
    participantCounters: {
        type: Map,
        of: Number,
        default: {}
    },

    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  { timestamps: true }
);

const Conversation = mongoose.model("Conversation", conversationSchema);

module.exports = Conversation;