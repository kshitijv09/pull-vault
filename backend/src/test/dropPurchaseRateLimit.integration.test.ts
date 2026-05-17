import jwt from "jsonwebtoken";
import Redis from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../app";
import { env } from "../config/env";
import { getAuctionRedis } from "../infra/redis/auctionWalletStore";
import {
  DROP_PURCHASE_MAX_REQUESTS_PER_IP_PER_DROP_PER_MINUTE,
  DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_DROP_PER_MINUTE
} from "../shared/constants/dropPurchaseRateLimit.constants";

const PURCHASE_PATH = "/api/drops/packs";
const TEST_CLIENT_IP = "203.0.113.50";

function purchaseUrl(dropId: string): string {
  return `${PURCHASE_PATH}/${dropId}/purchase`;
}

function signTestToken(userId: string): string {
  return jwt.sign({ id: userId, email: `${userId}@rate-limit.test` }, env.jwtSecret);
}

function rateLimitKeys(userId: string, dropId: string, clientIp: string): string[] {
  const ip = clientIp.replace(/:/g, "_");
  return [
    `pullvault:rl:drop_purchase:user:${userId}`,
    `pullvault:rl:drop_purchase:user:${userId}:drop:${dropId}`,
    `pullvault:rl:drop_purchase:ip:${ip}`,
    `pullvault:rl:drop_purchase:ip:${ip}:drop:${dropId}`
  ];
}

async function clearRateLimitKeys(userId: string, dropId: string, clientIp: string): Promise<void> {
  const redis = getAuctionRedis();
  if (!redis) return;
  const keys = rateLimitKeys(userId, dropId, clientIp);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

/**
 * Fire `count` purchase requests at once. The handler returns 501 after the
 * rate limiter passes, so 429 vs 501 isolates limiter behaviour.
 */
async function concurrentPurchases(options: {
  dropId: string;
  userId: string;
  count: number;
  clientIp?: string;
}): Promise<{ status: number; body: { error?: string } }[]> {
  const { dropId, userId, count, clientIp = TEST_CLIENT_IP } = options;
  const token = signTestToken(userId);
  const agent = request(app);

  return Promise.all(
    Array.from({ length: count }, () =>
      agent
        .post(purchaseUrl(dropId))
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", clientIp)
        .then((res) => ({ status: res.status, body: res.body as { error?: string } }))
    )
  );
}

function countStatuses(results: { status: number }[], status: number): number {
  return results.filter((r) => r.status === status).length;
}

async function probeRedis(url: string): Promise<boolean> {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    lazyConnect: true
  });
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

const redisUrl = env.redisUrl.trim();
let redisReachable = false;

describe("drop purchase rate limit (concurrent)", () => {
  beforeAll(async () => {
    redisReachable = redisUrl ? await probeRedis(redisUrl) : false;
  });
  const keysToCleanup: Array<{ userId: string; dropId: string; clientIp: string }> = [];

  afterAll(async () => {
    await Promise.all(
      keysToCleanup.map(({ userId, dropId, clientIp }) => clearRateLimitKeys(userId, dropId, clientIp))
    );
  });

  it("enforces per-user per-drop limit under concurrent load", async (ctx) => {
    if (!redisReachable) return ctx.skip();
    const userId = `rl-user-${Date.now()}`;
    const dropId = `rl-drop-${Date.now()}`;
    keysToCleanup.push({ userId, dropId, clientIp: TEST_CLIENT_IP });

    const burst = DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_DROP_PER_MINUTE + 10;
    const results = await concurrentPurchases({ dropId, userId, count: burst });

    const allowed = countStatuses(results, 501);
    const blocked = countStatuses(results, 429);

    expect(allowed).toBe(DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_DROP_PER_MINUTE);
    expect(blocked).toBe(burst - DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_DROP_PER_MINUTE);
    expect(results.every((r) => r.status === 501 || r.status === 429)).toBe(true);
    expect(results.some((r) => r.body.error?.includes("this drop"))).toBe(true);
  });

  it("enforces per-IP per-drop limit under concurrent load", async (ctx) => {
    if (!redisReachable) return ctx.skip();
    const dropId = `rl-drop-ip-${Date.now()}`;
    const burst = DROP_PURCHASE_MAX_REQUESTS_PER_IP_PER_DROP_PER_MINUTE + 15;
    const users = Array.from({ length: burst }, (_, i) => `rl-ip-user-${Date.now()}-${i}`);
    users.forEach((userId) => keysToCleanup.push({ userId, dropId, clientIp: TEST_CLIENT_IP }));

    const results = await Promise.all(
      users.map((userId) =>
        request(app)
          .post(purchaseUrl(dropId))
          .set("Authorization", `Bearer ${signTestToken(userId)}`)
          .set("X-Forwarded-For", TEST_CLIENT_IP)
          .then((res) => ({ status: res.status }))
      )
    );

    const allowed = countStatuses(results, 501);
    const blocked = countStatuses(results, 429);

    expect(allowed).toBe(DROP_PURCHASE_MAX_REQUESTS_PER_IP_PER_DROP_PER_MINUTE);
    expect(blocked).toBe(burst - DROP_PURCHASE_MAX_REQUESTS_PER_IP_PER_DROP_PER_MINUTE);
  });

  it("blocks the next request after the per-user per-drop ceiling is reached", async (ctx) => {
    if (!redisReachable) return ctx.skip();
    const userId = `rl-serial-user-${Date.now()}`;
    const dropId = `rl-serial-drop-${Date.now()}`;
    keysToCleanup.push({ userId, dropId, clientIp: TEST_CLIENT_IP });

    const token = signTestToken(userId);
    const agent = request(app);

    for (let i = 0; i < DROP_PURCHASE_MAX_REQUESTS_PER_USER_PER_DROP_PER_MINUTE; i++) {
      const res = await agent
        .post(purchaseUrl(dropId))
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", TEST_CLIENT_IP);
      expect(res.status).toBe(501);
    }

    const blocked = await agent
      .post(purchaseUrl(dropId))
      .set("Authorization", `Bearer ${token}`)
      .set("X-Forwarded-For", TEST_CLIENT_IP);

    expect(blocked.status).toBe(429);
  });
});
