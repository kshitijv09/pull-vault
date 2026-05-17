-- Atomic sliding-window limit for four keys:
-- user-global, user+drop, ip-global, ip+drop
-- ARGV:
-- now_ms, window_ms,
-- limit_user_global, limit_user_drop, limit_ip_global, limit_ip_drop,
-- member_user_global, member_user_drop, member_ip_global, member_ip_drop
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit_user_global = tonumber(ARGV[3])
local limit_user_drop = tonumber(ARGV[4])
local limit_ip_global = tonumber(ARGV[5])
local limit_ip_drop = tonumber(ARGV[6])
local member_user_global = ARGV[7]
local member_user_drop = ARGV[8]
local member_ip_global = ARGV[9]
local member_ip_drop = ARGV[10]

local cutoff = now - window

redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", cutoff)
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", cutoff)
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", cutoff)
redis.call("ZREMRANGEBYSCORE", KEYS[4], "-inf", cutoff)

local user_global = redis.call("ZCARD", KEYS[1])
local user_drop = redis.call("ZCARD", KEYS[2])
local ip_global = redis.call("ZCARD", KEYS[3])
local ip_drop = redis.call("ZCARD", KEYS[4])

if user_global >= limit_user_global then
  return { 0, "user_global" }
end
if user_drop >= limit_user_drop then
  return { 0, "user_drop" }
end
if ip_global >= limit_ip_global then
  return { 0, "ip_global" }
end
if ip_drop >= limit_ip_drop then
  return { 0, "ip_drop" }
end

redis.call("ZADD", KEYS[1], now, member_user_global)
redis.call("ZADD", KEYS[2], now, member_user_drop)
redis.call("ZADD", KEYS[3], now, member_ip_global)
redis.call("ZADD", KEYS[4], now, member_ip_drop)
redis.call("PEXPIRE", KEYS[1], window)
redis.call("PEXPIRE", KEYS[2], window)
redis.call("PEXPIRE", KEYS[3], window)
redis.call("PEXPIRE", KEYS[4], window)

return { 1, "ok" }
