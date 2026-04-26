-- KEYS
-- 1: auction end-time key (epoch ms string)
-- 2: highest bid key (decimal string)
-- 3: highest bidder key (uuid string)
-- 4: current bidder wallet key (decimal string)
--
-- ARGV
-- 1: now epoch ms
-- 2: bidder id
-- 3: bid amount
-- 4: min accepted bid amount
-- 5: trigger window ms (anti-sniping)
-- 6: extension ms (anti-sniping)
-- 7: auction wallet key prefix (e.g., pullvault:auction:<id>:wallet:)
-- 8: required bid coverage multiplier (e.g., 1.05 for 5% premium buffer)
--
-- Returns tuples:
-- [-1] auction_not_started_or_expired_key
-- [-2] auction_already_ended
-- [-3] invalid_numbers
-- [-4] bid_below_minimum
-- [-5] bidder_already_highest
-- [-6] bid_not_higher_than_current
-- [-7] bidder_wallet_missing
-- [-8] bidder_insufficient_funds
-- [1, acceptedBid, bidderId, newEndMs, minNextBid]

local endMsRaw = redis.call("GET", KEYS[1])
if not endMsRaw then
  return { -1 }
end

local nowMs = tonumber(ARGV[1])
local endMs = tonumber(endMsRaw)
local bidAmount = tonumber(ARGV[3])
local minAccepted = tonumber(ARGV[4])
local triggerWindowMs = tonumber(ARGV[5]) or 0
local extensionMs = tonumber(ARGV[6]) or 0
local requiredCoverageMultiplier = tonumber(ARGV[8]) or 1
if (not nowMs) or (not endMs) or (not bidAmount) or (not minAccepted) then
  return { -3 }
end

if nowMs >= endMs then
  return { -2 }
end

if bidAmount < minAccepted then
  return { -4 }
end

local currentBidder = redis.call("GET", KEYS[3])
if currentBidder and currentBidder == ARGV[2] then
  return { -5 }
end

local currentBidRaw = redis.call("GET", KEYS[2])
local currentBid = currentBidRaw and tonumber(currentBidRaw) or nil
if currentBid and bidAmount <= currentBid then
  return { -6 }
end

local bidderWalletRaw = redis.call("GET", KEYS[4])
if not bidderWalletRaw then
  return { -7 }
end
local bidderWallet = tonumber(bidderWalletRaw)
if not bidderWallet then
  return { -3 }
end
-- Require bidder wallet to cover bid amount plus configurable auction premium buffer.
local requiredWithPremium = bidAmount * requiredCoverageMultiplier
if bidderWallet < requiredWithPremium then
  return { -8 }
end

if currentBidder and currentBid then
  local prevWalletKey = ARGV[7] .. currentBidder
  local prevWalletRaw = redis.call("GET", prevWalletKey)
  if prevWalletRaw then
    local prevWallet = tonumber(prevWalletRaw)
    if prevWallet then
      redis.call("SET", prevWalletKey, string.format("%.2f", prevWallet + currentBid))
    end
  end
end

redis.call("SET", KEYS[4], string.format("%.2f", bidderWallet - bidAmount))
redis.call("SET", KEYS[2], string.format("%.2f", bidAmount))
redis.call("SET", KEYS[3], ARGV[2])

local newEndMs = endMs
local remainingMs = endMs - nowMs
if triggerWindowMs > 0 and extensionMs > 0 and remainingMs <= triggerWindowMs then
  newEndMs = endMs + extensionMs
  redis.call("SET", KEYS[1], tostring(newEndMs))
  redis.call("PEXPIRE", KEYS[1], newEndMs - nowMs)
end

local minNextBid = bidAmount
return { 1, string.format("%.2f", bidAmount), ARGV[2], tostring(newEndMs), string.format("%.2f", minNextBid) }
