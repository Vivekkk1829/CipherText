const getConversationId = (user1, user2) => {
  // Ensure we are working with strings to prevent errors
  const id1 = user1.toString(); 
  const id2 = user2.toString();

  // Sort alphabetically to ensure consistency
  return id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;
};

module.exports = getConversationId;