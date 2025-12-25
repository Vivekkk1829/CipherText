const User = require("../models/User");

const getUsers = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    // FIX: Added 'publicKey' to the select string so the frontend can use it!
    const users = await User.find({
      _id: { $ne: currentUserId },
    }).select("_id userName email publicKey");

    return res.status(200).json({
      success: true,
      users,
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