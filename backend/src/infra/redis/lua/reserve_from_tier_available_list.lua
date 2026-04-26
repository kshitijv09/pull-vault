-- KEYS[1] = tier available list (RPUSH order: front of line = index 0 = current pack to drain)
-- ARGV[1] = optional PUBLISH channel (notify subscribers after remaining is decremented)
-- ARGV[2] = required pack price USD (number string)
-- ARGV[3] = cached user wallet balance USD (number string from common Redis key)
-- Per-pack remaining: pullvault:pack:{uuid}:remaining (built in Lua to match Node)
--
-- Peeks head pack id; skips stale heads with remaining <= 0; DECRs; LPOPs head when remaining hits 0.
-- Returns { pack_id, new_remaining } on success.
-- Returns { -1 } sold out / empty list, { -2 } wallet missing, { -3 } wallet insufficient.
local listKey = KEYS[1]
local publishChannel = ARGV[1]
local requiredAmount = tonumber(ARGV[2] or "0")
local walletBalance = tonumber(ARGV[3] or "")
local maxStale = 64
local i = 0

if (not requiredAmount) or requiredAmount <= 0 then
  return {-3}
end

if not walletBalance then
  return {-2}
end
if walletBalance < requiredAmount then
  return {-3}
end

while i < maxStale do
  i = i + 1
  local packId = redis.call("LINDEX", listKey, 0)
  if not packId then
    return {-1}
  end
  packId = tostring(packId)
  local remKey = "pullvault:pack:" .. packId .. ":remaining"
  local v = tonumber(redis.call("GET", remKey) or "0")
  if v <= 0 then
    redis.call("LPOP", listKey)
  else
    local newv = redis.call("DECR", remKey)
    if newv == 0 then
      redis.call("LPOP", listKey)
    end
    if publishChannel and publishChannel ~= "" then
      redis.call("PUBLISH", publishChannel, "reserve")
    end
    return {packId, newv}
  end
end

return {-1}
