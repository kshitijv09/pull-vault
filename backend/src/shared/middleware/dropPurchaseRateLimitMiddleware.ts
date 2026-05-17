import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Response, NextFunction } from "express";
import { getAuctionRedis } from "../../infra/redis/auctionWalletStore";
import { PlatformHealthRepository } from "../../modules/analytics/platformHealth.repository";
import type { RateLimitBlockScope } from "../../modules/analytics/platformHealth.types";
import {
  DROP_PURCHASE_MAX_REQUESTS_PER_IP_PER_DROP_PER_MINUTE,
  DROP_PURCHASE_MAX_REQUESTS_PER_IP_PER_MINUTE,
  DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_DROP_PER_MINUTE,
  DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_MINUTE,
  DROP_PURCHASE_RATE_LIMIT_WINDOW_MS
} from "../constants/dropPurchaseRateLimit.constants";
import { AppError } from "../errors/AppError";
import type { AuthRequest } from "./authMiddleware";

const VALID_BLOCK_SCOPES: ReadonlySet<RateLimitBlockScope> = new Set<RateLimitBlockScope>([
  "user_global",
  "user_drop",
  "ip_global",
  "ip_drop"
]);
const platformHealthRepoForBlocks = new PlatformHealthRepository();

const script = readFileSync(join(__dirname, "..", "..", "infra", "redis", "lua", "drop_purchase_rate_limit.lua"), "utf8");

function purchaseRateLimitGlobalKey(userId: string): string {
  return `pullvault:rl:drop_purchase:user:${userId}`;
}

function purchaseRateLimitPerDropKey(userId: string, dropId: string): string {
  return `pullvault:rl:drop_purchase:user:${userId}:drop:${dropId}`;
}

function purchaseRateLimitIpGlobalKey(ip: string): string {
  return `pullvault:rl:drop_purchase:ip:${ip}`;
}

function purchaseRateLimitIpPerDropKey(ip: string, dropId: string): string {
  return `pullvault:rl:drop_purchase:ip:${ip}:drop:${dropId}`;
}

function normalizedClientIp(req: AuthRequest): string {
  const xForwardedFor = req.headers["x-forwarded-for"];
  const forwarded =
    typeof xForwardedFor === "string"
      ? xForwardedFor.split(",")[0]?.trim()
      : Array.isArray(xForwardedFor)
        ? xForwardedFor[0]?.split(",")[0]?.trim()
        : "";
  const direct = typeof req.ip === "string" ? req.ip.trim() : "";
  return (forwarded || direct || "").replace(/:/g, "_");
}

/**
 * Sliding-window rate limit per JWT user id (Redis ZSET scores = request time ms).
 * Enforces per-user and per-IP global/per-drop per-minute ceilings.
 */
export async function dropPurchaseRateLimitMiddleware(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id?.trim();
  const dropId = typeof req.params.dropId === "string" ? req.params.dropId.trim() : "";
  const clientIp = normalizedClientIp(req);

  if (!userId) {
    return next(new AppError("Authentication token is missing or invalid", 401));
  }
  if (!dropId) {
    return next(new AppError("Drop id is required", 400));
  }
  if (!clientIp) {
    return next(new AppError("Unable to resolve client IP for rate limiting", 400));
  }

  const redis = getAuctionRedis();
  if (!redis) {
    return next(new AppError("Rate limiting is unavailable (Redis not configured).", 503));
  }

  const now = Date.now();
  const suffix = randomUUID();
  const memberUserGlobal = `${now}:${suffix}:ug`;
  const memberUserDrop = `${now}:${suffix}:ud`;
  const memberIpGlobal = `${now}:${suffix}:ig`;
  const memberIpDrop = `${now}:${suffix}:id`;

  try {
    const raw = (await redis.eval(
      script,
      4,
      purchaseRateLimitGlobalKey(userId),
      purchaseRateLimitPerDropKey(userId, dropId),
      purchaseRateLimitIpGlobalKey(clientIp),
      purchaseRateLimitIpPerDropKey(clientIp, dropId),
      String(now),
      String(DROP_PURCHASE_RATE_LIMIT_WINDOW_MS),
      String(DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_MINUTE),
      String(DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_DROP_PER_MINUTE),
      String(DROP_PURCHASE_MAX_REQUESTS_PER_IP_PER_MINUTE),
      String(DROP_PURCHASE_MAX_REQUESTS_PER_IP_PER_DROP_PER_MINUTE),
      memberUserGlobal,
      memberUserDrop,
      memberIpGlobal,
      memberIpDrop
    )) as unknown;

    const allowed = Array.isArray(raw) && raw[0] === 1;
    if (allowed) {
      return next();
    }

    const scope = Array.isArray(raw) ? String(raw[1]) : "";
    const normalisedScope: RateLimitBlockScope =
      VALID_BLOCK_SCOPES.has(scope as RateLimitBlockScope)
        ? (scope as RateLimitBlockScope)
        : "user_global";

    // Fire-and-forget audit log (B5 fraud panel). We intentionally do NOT await
    // — the user-facing 429 must not be delayed by a logging insert, and a DB
    // hiccup must not turn a rate-limit decision into a 503.
    platformHealthRepoForBlocks
      .insertBlock({
        scope: normalisedScope,
        userId,
        dropId,
        clientIp,
        endpoint: `${req.method} ${req.baseUrl || ""}${req.path || ""}`
      })
      .catch((err) => {
        console.error("[dropPurchaseRateLimitMiddleware] block log failed", err);
      });

    const message = (() => {
      if (scope === "user_drop") {
        return "Too many purchase attempts for this drop. Try again in a moment.";
      }
      if (scope === "ip_global") {
        return "Too many purchase attempts from this IP. Try again in a moment.";
      }
      if (scope === "ip_drop") {
        return "Too many purchase attempts for this drop from this IP. Try again in a moment.";
      }
      return "Too many purchase attempts. Try again in a moment.";
    })();
    return next(new AppError(message, 429));
  } catch (err) {
    console.error("[dropPurchaseRateLimitMiddleware] Redis eval failed", err);
    return next(new AppError("Rate limiting check failed.", 503));
  }
}
