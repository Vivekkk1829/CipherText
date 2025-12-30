// utils/redisScript.js

const LUA_SCRIPT = `
  local uuid_key = KEYS[1]      -- Redis Key: Current Session UUID
  local seq_key = KEYS[2]       -- Redis Key: Expected Client ID (1, 2, 3...)
  local buffer_key = KEYS[3]    -- Redis Key: Buffered Messages (Sorted Set)

  local incoming_uuid = ARGV[1]
  local incoming_client_id = tonumber(ARGV[2])
  local message_payload = ARGV[3]

  -- 1. SESSION CHECK
  -- If the UUID changed (user reinstalled or refreshed), we reset everything.
  local stored_uuid = redis.call('GET', uuid_key)

  if (not stored_uuid) or (stored_uuid ~= incoming_uuid) then
      redis.call('SET', uuid_key, incoming_uuid)
      redis.call('SET', seq_key, 1)   -- Reset expected counter to 1
      redis.call('DEL', buffer_key)   -- Clear old buffer
  end

  -- 2. GET EXPECTED ID
  local expected_id = tonumber(redis.call('GET', seq_key))
  if not expected_id then expected_id = 1 end

  -- 3. COMPARE LOGIC
  if incoming_client_id == expected_id then
      -- ✅ CORRECT ORDER
      redis.call('INCR', seq_key) -- Increment expected ID
      return {1, "PROCESS"}       

  elseif incoming_client_id > expected_id then
      -- ⏳ FUTURE MESSAGE (Buffer it)
      redis.call('ZADD', buffer_key, incoming_client_id, message_payload)
      return {2, "BUFFERED"}      

  else
      -- 🗑️ DUPLICATE / OLD
      return {0, "IGNORED"}       
  end
`;

module.exports = LUA_SCRIPT;