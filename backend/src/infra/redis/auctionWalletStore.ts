import { readFileSync } from "node:fs";
import { join } from "node:path";
import Redis from "ioredis";
import { env } from "../../config/env";
import type { AuctionBidBroadcastPayload } from "../../modules/auction/auction.types";
import { AUCTION_BID_PREMIUM_MULTIPLIER } from "../../shared/constants/premiums";

const assertAuctionActiveScript = readFileSync(
  join(__dirname, "lua", "assert_auction_active.lua"),
  "utf8"
);
const debitWalletIfSufficientScript = readFileSync(
  join(__dirname, "lua", "debit_wallet_if_sufficient.lua"),
  "utf8"
);
const placeAuctionBidScript = readFileSync(join(__dirname, "lua", "place_auction_bid.lua"), "utf8");

let auctionRedis: Redis | null | undefined;

export function getAuctionRedis(): Redis | null {
  if (auctionRedis === undefined) {
    const url = env.redisUrl.trim() || env.redisShardUrls[0] || "";
    auctionRedis = url ? new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true }) : null;
  }
  return auctionRedis;
}

export function auctionEndTimeKey(auctionId: string): string {
  return `pullvault:auction:${auctionId.trim()}:end_ms`;
}

export function auctionWalletKey(auctionId: string, userId: string): string {
  return userWalletBalanceKey(userId);
}

export function auctionWalletPrefix(auctionId: string): string {
  return "pullvault:user:wallet:balance:";
}

export function userWalletBalanceKey(userId: string): string {
  return `pullvault:user:wallet:balance:${userId.trim()}`;
}

export function auctionHighestBidKey(auctionId: string): string {
  return `pullvault:auction:${auctionId.trim()}:highest_bid_usd`;
}

export function auctionHighestBidderKey(auctionId: string): string {
  return `pullvault:auction:${auctionId.trim()}:highest_bidder_id`;
}

export function auctionParticipantsKey(auctionId: string): string {
  return `pullvault:auction:${auctionId.trim()}:participants`;
}

export function auctionViewerUsersKey(auctionId: string): string {
  return `pullvault:auction:${auctionId.trim()}:viewer_users`;
}

export function auctionViewerCountKey(auctionId: string, userId: string): string {
  return `pullvault:auction:${auctionId.trim()}:viewer_count:${userId.trim()}`;
}

export async function cacheAuctionEndTimeWithTtl(auctionId: string, endTimeIso: string): Promise<void> {
  const redis = getAuctionRedis();
  if (!redis) {
    return;
  }
  const endMs = Date.parse(endTimeIso);
  if (!Number.isFinite(endMs)) {
    throw new Error("Invalid auction end time.");
  }
  const ttlMs = Math.floor(endMs - Date.now());
  if (ttlMs <= 0) {
    throw new Error("Auction already expired.");
  }
  await redis.set(auctionEndTimeKey(auctionId), String(Math.floor(endMs)), "PX", ttlMs);
}

export async function getAuctionCountdownState(
  auctionId: string
): Promise<{ ok: true; ttlMs: number } | { ok: false; reason: "not_configured" | "not_started" | "ended" }> {
  const redis = getAuctionRedis();
  if (!redis) {
    return { ok: false, reason: "not_configured" };
  }

  const codeRaw = await redis.eval(assertAuctionActiveScript, 1, auctionEndTimeKey(auctionId), String(Date.now()));
  const code = typeof codeRaw === "number" ? codeRaw : Number(codeRaw);
  if (code !== 1) {
    return {
      ok: false,
      reason: code === 0 ? "ended" : "not_started"
    };
  }

  const ttlMs = await redis.pttl(auctionEndTimeKey(auctionId));
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return { ok: false, reason: "ended" };
  }

  return { ok: true, ttlMs };
}

export async function getOrPrimeWalletBalance(
  key: string,
  fallbackBalanceUsd: string,
  ttlSeconds?: number
): Promise<{ balanceUsd: string; source: "cache" | "db" } | null> {
  const redis = getAuctionRedis();
  if (!redis) {
    return null;
  }

  const existing = await redis.get(key);
  if (existing != null && existing !== "") {
    return { balanceUsd: existing, source: "cache" };
  }

  if (ttlSeconds && ttlSeconds > 0) {
    await redis.set(key, fallbackBalanceUsd, "EX", ttlSeconds, "NX");
  } else {
    await redis.set(key, fallbackBalanceUsd, "NX");
  }

  const finalValue = await redis.get(key);
  return {
    balanceUsd: finalValue != null && finalValue !== "" ? finalValue : fallbackBalanceUsd,
    source: "db"
  };
}

export async function setCachedWalletBalance(
  key: string,
  balanceUsd: string,
  ttlSeconds?: number
): Promise<void> {
  const redis = getAuctionRedis();
  if (!redis) {
    return;
  }
  if (ttlSeconds && ttlSeconds > 0) {
    await redis.set(key, balanceUsd, "EX", ttlSeconds);
    return;
  }
  await redis.set(key, balanceUsd);
}

export async function updateCachedWalletBalanceIfExists(
  key: string,
  balanceUsd: string
): Promise<void> {
  const redis = getAuctionRedis();
  if (!redis) {
    return;
  }
  // Using a Lua script or simply EXISTS + SET would work.
  // Using WATCH or a single Lua script is safer for atomicity, but for a simple "update if exists"
  // a Lua script is easiest.
  const script = `
    if redis.call("EXISTS", KEYS[1]) == 1 then
      return redis.call("SET", KEYS[1], ARGV[1])
    end
    return nil
  `;
  await redis.eval(script, 1, key, balanceUsd);
}

export async function getCachedHighestBidState(
  auctionId: string
): Promise<{ bidUsd: string; bidderId: string } | null> {
  const redis = getAuctionRedis();
  if (!redis) {
    return null;
  }
  const [bidUsd, bidderId] = await redis.mget(auctionHighestBidKey(auctionId), auctionHighestBidderKey(auctionId));
  if (!bidUsd || !bidderId) {
    return null;
  }
  return { bidUsd, bidderId };
}

export async function primeHighestBidState(
  auctionId: string,
  highBidUsd: string,
  highBidderId: string,
  ttlSeconds?: number
): Promise<void> {
  const redis = getAuctionRedis();
  if (!redis) {
    return;
  }
  const bidKey = auctionHighestBidKey(auctionId);
  const bidderKey = auctionHighestBidderKey(auctionId);
  await redis.set(bidKey, highBidUsd, "NX");
  await redis.set(bidderKey, highBidderId, "NX");
  if (ttlSeconds && ttlSeconds > 0) {
    await redis.expire(bidKey, ttlSeconds);
    await redis.expire(bidderKey, ttlSeconds);
  }
}

export async function creditCachedWalletBalance(
  key: string,
  amountUsd: string,
  ttlSeconds?: number
): Promise<string | null> {
  const redis = getAuctionRedis();
  if (!redis) {
    return null;
  }
  const next = await redis.incrbyfloat(key, Number(amountUsd));
  if (ttlSeconds && ttlSeconds > 0) {
    await redis.expire(key, ttlSeconds);
  }
  return Number(next).toFixed(2);
}

export async function debitCachedWalletBalanceIfSufficient(
  key: string,
  amountUsd: string
): Promise<{ ok: true; newBalanceUsd: string } | { ok: false; reason: "missing" | "invalid" | "insufficient" }> {
  const redis = getAuctionRedis();
  if (!redis) {
    return { ok: false, reason: "missing" };
  }
  const raw = await redis.eval(debitWalletIfSufficientScript, 1, key, amountUsd);
  const code = typeof raw === "number" ? raw : Number(raw);

  if (Number.isFinite(code) && code < 0) {
    if (code === -4) {
      return { ok: false, reason: "insufficient" };
    }
    if (code === -1) {
      return { ok: false, reason: "missing" };
    }
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, newBalanceUsd: String(raw) };
}

export async function placeAuctionBidInRedis(input: {
  auctionId: string;
  bidderId: string;
  bidAmountUsd: string;
  minAcceptedBidUsd: string;
  triggerWindowMs: number;
  extensionMs: number;
  requiredCoverageMultiplier?: number;
}): Promise<
  | { ok: true; acceptedBidUsd: string; bidderId: string; endTimeMs: number }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "not_started"
        | "ended"
        | "invalid"
        | "below_minimum"
        | "same_bidder"
        | "not_higher"
        | "wallet_missing"
        | "insufficient";
    }
> {
  const redis = getAuctionRedis();
  if (!redis) {
    return { ok: false, reason: "not_configured" };
  }

  const raw = await redis.eval(
    placeAuctionBidScript,
    4,
    auctionEndTimeKey(input.auctionId),
    auctionHighestBidKey(input.auctionId),
    auctionHighestBidderKey(input.auctionId),
    auctionWalletKey(input.auctionId, input.bidderId),
    String(Date.now()),
    input.bidderId,
    input.bidAmountUsd,
    input.minAcceptedBidUsd,
    String(Math.max(0, Math.floor(input.triggerWindowMs))),
    String(Math.max(0, Math.floor(input.extensionMs))),
    auctionWalletPrefix(input.auctionId),
    String(input.requiredCoverageMultiplier ?? AUCTION_BID_PREMIUM_MULTIPLIER)
  );

  const tuple = Array.isArray(raw) ? raw : [raw];
  const status = Number(tuple[0]);
  if (status !== 1) {
    if (status === -1) return { ok: false, reason: "not_started" };
    if (status === -2) return { ok: false, reason: "ended" };
    if (status === -4) return { ok: false, reason: "below_minimum" };
    if (status === -5) return { ok: false, reason: "same_bidder" };
    if (status === -6) return { ok: false, reason: "not_higher" };
    if (status === -7) return { ok: false, reason: "wallet_missing" };
    if (status === -8) return { ok: false, reason: "insufficient" };
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    acceptedBidUsd: String(tuple[1]),
    bidderId: String(tuple[2]),
    endTimeMs: Number(tuple[3])
  };
}

export async function publishAuctionBidUpdated(payload: AuctionBidBroadcastPayload): Promise<void> {
  const redis = getAuctionRedis();
  if (!redis) {
    return;
  }
  await redis.publish(env.auctionBidBroadcastChannel, JSON.stringify(payload));
}

export async function markAuctionParticipant(auctionId: string, userId: string, ttlSeconds?: number): Promise<void> {
  const redis = getAuctionRedis();
  if (!redis) {
    return;
  }
  const key = auctionParticipantsKey(auctionId);
  await redis.sadd(key, userId.trim());
  if (ttlSeconds && ttlSeconds > 0) {
    await redis.expire(key, ttlSeconds);
  }
}

export async function listAuctionParticipants(auctionId: string): Promise<string[]> {
  const redis = getAuctionRedis();
  if (!redis) {
    return [];
  }
  const raw = await redis.smembers(auctionParticipantsKey(auctionId));
  return raw.map((x) => x.trim()).filter(Boolean);
}

export async function getAuctionWalletBalanceFromCache(
  auctionId: string,
  userId: string
): Promise<string | null> {
  const redis = getAuctionRedis();
  if (!redis) {
    return null;
  }
  const value = await redis.get(auctionWalletKey(auctionId, userId));
  return value != null && value !== "" ? value : null;
}

export async function clearAuctionRuntimeKeys(auctionId: string): Promise<void> {
  const redis = getAuctionRedis();
  if (!redis) {
    return;
  }
  const keysToDelete: string[] = [];
  let cursor = "0";
  const matchPattern = `pullvault:auction:${auctionId.trim()}:*`;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", matchPattern, "COUNT", 200);
    cursor = String(nextCursor);
    if (Array.isArray(keys) && keys.length > 0) {
      keysToDelete.push(...keys);
    }
  } while (cursor !== "0");

  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
  }
}
