-- Sealed phase bid: does not update public high bid; reserves amount in bidder wallet.
-- KEYS[1] end_ms
-- KEYS[2] sealed_phase (must be "1")
-- KEYS[3] bidder wallet balance key
-- KEYS[4] sealed bids hash field bidderId -> amount
-- KEYS[5] sealed bid timestamp hash field bidderId -> ms
--
-- ARGV[1] now ms
-- ARGV[2] bidder id
-- ARGV[3] bid amount
-- ARGV[4] min accepted bid
-- ARGV[5] required coverage multiplier
--
-- Returns:
-- [-1] missing end key
-- [-2] auction ended
-- [-3] invalid
-- [-4] below minimum
-- [-7] wallet missing
-- [-8] insufficient
-- [-10] sealed phase not active
-- [-11] sealed bid already submitted by this bidder
-- [1, endMs, newWalletBalance]

local endMsRaw = redis.call("GET", KEYS[1])
if not endMsRaw then
  return { -1 }
end

if redis.call("GET", KEYS[2]) ~= "1" then
  return { -10 }
end

local nowMs = tonumber(ARGV[1])
local endMs = tonumber(endMsRaw)
local bidAmount = tonumber(ARGV[3])
local minAccepted = tonumber(ARGV[4])
local mult = tonumber(ARGV[5]) or 1

if (not nowMs) or (not endMs) or (not bidAmount) or (not minAccepted) then
  return { -3 }
end

if nowMs >= endMs then
  return { -2 }
end

if bidAmount < minAccepted then
  return { -4 }
end

local walletRaw = redis.call("GET", KEYS[3])
if not walletRaw then
  return { -7 }
end
local wallet = tonumber(walletRaw)
if not wallet then
  return { -3 }
end

if redis.call("HGET", KEYS[4], ARGV[2]) then
  return { -11 }
end

local required = bidAmount * mult
if wallet < required then
  return { -8 }
end

local nextBal = wallet - bidAmount
redis.call("SET", KEYS[3], string.format("%.2f", nextBal))
redis.call("HSET", KEYS[4], ARGV[2], string.format("%.2f", bidAmount))
redis.call("HSET", KEYS[5], ARGV[2], tostring(nowMs))

local ttlMs = endMs - nowMs
if ttlMs > 0 then
  redis.call("PEXPIRE", KEYS[4], ttlMs)
  redis.call("PEXPIRE", KEYS[5], ttlMs)
end

return { 1, tostring(endMs), string.format("%.2f", nextBal) }
