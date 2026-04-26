-- KEYS[1] = wallet balance key
-- ARGV[1] = debit amount (positive decimal)
--
-- Returns:
--  -1 -> key missing
--  -2 -> malformed key value / malformed amount
--  -3 -> amount <= 0
--  -4 -> insufficient balance
--  <string balance> -> new balance after debit
local balanceRaw = redis.call("GET", KEYS[1])
if not balanceRaw then
  return -1
end

local amount = tonumber(ARGV[1])
if not amount then
  return -2
end
if amount <= 0 then
  return -3
end

local balance = tonumber(balanceRaw)
if not balance then
  return -2
end

if balance < amount then
  return -4
end

local nextBalance = balance - amount
redis.call("SET", KEYS[1], string.format("%.2f", nextBalance))
return string.format("%.2f", nextBalance)
