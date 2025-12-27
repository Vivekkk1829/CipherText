const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
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
    
    // CONTENT: Stores the "Ciphertext" (Gibberish)
    content: {
      type: String,
      required: true,
    },

    // IV: Essential for AES-256. 
    // In strict E2EE, this should rarely be null.
    iv: {
      type: String,
      required: true, // Force the frontend to send an IV
    },

    type: {
      type: String,
      enum: ["text", "image", "file"],
      default: "text",
    },

    // METADATA: This is Public (Server sees this)
    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent",
    },

    isEncrypted: {
      type: Boolean,
      default: true, 
    },
  },
  {
    timestamps: true,
  }
);

// ---------------------------------------------------------
// THE "RESUME" FEATURE: COMPOUND INDEXING 🚀
// ---------------------------------------------------------
// This line makes your chat history queries O(log N).
// It groups messages between two users and sorts by time (-1).
messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, sender: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);