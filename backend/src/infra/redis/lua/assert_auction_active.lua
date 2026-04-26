-- KEYS[1] = auction end-time key (epoch ms as string)
-- ARGV[1] = current epoch ms
--
-- Returns:
--   1  -> auction key exists and end-time is still in the future
--   0  -> key exists but auction has ended
--  -1  -> key missing (auction not started / expired)
--  -2  -> malformed end-time value
local endMsRaw = redis.call("GET", KEYS[1])
if not endMsRaw then
  return -1
end

local endMs = tonumber(endMsRaw)
if not endMs then
  return -2
end

local nowMs = tonumber(ARGV[1])
if not nowMs then
  return -2
end

if nowMs >= endMs then
  return 0
end

return 1
