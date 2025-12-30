
const getConversationId = (user1, user2) => {
  // .toString() safely converts ObjectId to string
  const id1 = user1.toString(); 
  const id2 = user2.toString();

  return id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;
};

module.exports = getConversationId;