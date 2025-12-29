const User = require("../models/User");
const Message = require("../models/Message"); // <--- 1. Import Message Model

const getUsers = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    // Fetch users (excluding self) with specific fields
    const users = await User.find({
      _id: { $ne: currentUserId },
    }).select("_id userName email publicKey");

    // 2. Add "unreadCount" to each user
    const usersWithCounts = await Promise.all(
      users.map(async (user) => {
        // Count messages sent BY this user TO me that are NOT seen
        const unreadCount = await Message.countDocuments({
          sender: user._id,
          receiver: currentUserId,
          status: { $ne: "seen" }, 
        });

        // Convert Mongoose document to plain object and add count
        return { 
            ...user.toObject(), 
            unreadCount 
        };
      })
    );

    return res.status(200).json({
      success: true,
      users: usersWithCounts, // Return the list with counts
    });
    
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Unable to fetch users",
    });
  }
};

module.exports = { getUsers };