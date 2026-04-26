import type { IncomingMessage } from "node:http";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import type { RawData } from "ws";
import { WebSocket, WebSocketServer } from "ws";
import { env } from "../../config/env";
import {
  auctionViewerCountKey,
  auctionViewerUsersKey,
  getCachedHighestBidState,
  getAuctionWalletBalanceFromCache,
  getAuctionRedis
} from "../redis/auctionWalletStore";
import { AuctionRepository } from "../../modules/auction/auction.repository";
import type { AuctionBidBroadcastPayload } from "../../modules/auction/auction.types";

type JwtPayload = { id: string; email: string };

interface ClientMeta {
  userId: string;
  auctionIds: Set<string>;
}

function extractToken(req: IncomingMessage): string {
  const raw = req.url ?? "";
  const q = raw.includes("?") ? raw.split("?", 2)[1] : "";
  const fromQuery = new URLSearchParams(q).get("token")?.trim() ?? "";
  if (fromQuery) {
    return fromQuery;
  }
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

export class AuctionSocketServer {
  private readonly wss: WebSocketServer;
  private readonly repository: AuctionRepository;
  private readonly wsMeta = new Map<WebSocket, ClientMeta>();
  private readonly auctionToSockets = new Map<string, Set<WebSocket>>();
  private redisSubscriber: Redis | null = null;
  private redisPublisher: Redis | null = null;

  constructor(wss: WebSocketServer) {
    this.wss = wss;
    this.repository = new AuctionRepository();
  }

  async start(): Promise<void> {
    const url = env.redisUrl.trim() || env.redisShardUrls[0] || "";
    if (url) {
      this.redisSubscriber = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true });
      this.redisPublisher = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true });
      await this.redisSubscriber.subscribe(env.auctionBidBroadcastChannel);
      this.redisSubscriber.on("message", (_channel, message) => {
        this.onAuctionBroadcast(message);
      });
    } else {
      console.warn("[auctionSocketServer] Redis not configured; auction bid pub/sub disabled.");
    }

    this.wss.on("connection", (ws, req) => {
      void this.onConnection(ws, req);
    });

    console.log("[auctionSocketServer] listening at /ws/auction");
  }

  private onAuctionBroadcast(raw: string): void {
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.type !== "string" ||
      typeof payload.auctionListingId !== "string"
    ) {
      return;
    }

    const set = this.auctionToSockets.get(payload.auctionListingId);
    if (!set || set.size === 0) {
      return;
    }

    const encoded = JSON.stringify(payload);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encoded);
      }
    }
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const token = extractToken(req);
    let userId = "";
    try {
      const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
      userId = decoded.id?.trim() ?? "";
      if (!userId) {
        throw new Error("missing user id");
      }
    } catch {
      ws.close(1008, "Invalid or expired token");
      return;
    }

    this.wsMeta.set(ws, { userId, auctionIds: new Set() });

    ws.on("message", (data) => {
      void this.onClientMessage(ws, data);
    });
    ws.on("close", () => this.detach(ws));
    ws.on("error", () => this.detach(ws));
  }

  private detach(ws: WebSocket): void {
    const meta = this.wsMeta.get(ws);
    if (!meta) {
      return;
    }
    for (const auctionId of meta.auctionIds) {
      void this.unregisterViewer(auctionId, meta.userId);
      const set = this.auctionToSockets.get(auctionId);
      if (!set) {
        continue;
      }
      set.delete(ws);
      if (set.size === 0) {
        this.auctionToSockets.delete(auctionId);
      }
    }
    this.wsMeta.delete(ws);
  }

  private async onClientMessage(ws: WebSocket, data: RawData): Promise<void> {
    let parsed: { type?: string; auctionId?: unknown };
    try {
      const text = typeof data === "string" ? data : data.toString("utf8");
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      return;
    }
    if (parsed.type !== "subscribe_auction" || typeof parsed.auctionId !== "string") {
      return;
    }
    const auctionId = parsed.auctionId.trim();
    if (!auctionId) {
      return;
    }

    let set = this.auctionToSockets.get(auctionId);
    if (!set) {
      set = new Set();
      this.auctionToSockets.set(auctionId, set);
    }
    set.add(ws);

    const meta = this.wsMeta.get(ws);
    const alreadySubscribed = Boolean(meta?.auctionIds.has(auctionId));
    if (meta && !alreadySubscribed) {
      meta.auctionIds.add(auctionId);
    }
    if (!alreadySubscribed) {
      await this.registerViewer(auctionId, meta?.userId ?? "");
    }

    const snapshot = await this.buildSnapshot(auctionId, meta?.userId ?? "");
    if (snapshot && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(snapshot));
    }
  }

  private async buildSnapshot(auctionListingId: string, userId: string): Promise<{
    type: "auction_snapshot";
    auctionListingId: string;
    currentBidUsd: string;
    currentBidderId: string | null;
    endTime: string;
    minNextBidUsd: string;
    viewerCount: number;
    walletBalanceUsd?: string;
    bidHistory: AuctionBidBroadcastPayload["bidHistory"];
    updatedAt: string;
  } | null> {
    const listing = await this.repository.getAuctionListingById(auctionListingId);
    if (!listing) {
      return null;
    }
    const cachedHighest = await getCachedHighestBidState(auctionListingId);
    const currentBidUsd = cachedHighest?.bidUsd ?? listing.startBidUsd;
    const incrementUsd =
      (await this.repository.getMinIncrementForCurrentPrice(currentBidUsd)) ??
      this.defaultIncrementFor(currentBidUsd);
    const minNextBidUsd = (Number(currentBidUsd) + Number(incrementUsd)).toFixed(2);
    const bidHistory = await this.repository.listBidHistory(auctionListingId, 20);
    const viewerCount = await this.getViewerCount(auctionListingId);
    const walletBalanceUsd =
      userId.trim().length > 0
        ? await getAuctionWalletBalanceFromCache(auctionListingId, userId)
        : null;

    return {
      type: "auction_snapshot",
      auctionListingId,
      currentBidUsd,
      currentBidderId: cachedHighest?.bidderId ?? null,
      endTime: listing.endTime,
      minNextBidUsd,
      viewerCount,
      walletBalanceUsd: walletBalanceUsd ?? undefined,
      bidHistory,
      updatedAt: new Date().toISOString()
    };
  }

  private async registerViewer(auctionId: string, userId: string): Promise<void> {
    if (!userId.trim()) {
      return;
    }
    const redis = getAuctionRedis();
    if (!redis) {
      return;
    }
    const countKey = auctionViewerCountKey(auctionId, userId);
    const userSetKey = auctionViewerUsersKey(auctionId);
    const next = await redis.incr(countKey);
    if (next === 1) {
      await redis.sadd(userSetKey, userId);
    }
    await redis.expire(countKey, 3600);
    await redis.expire(userSetKey, 3600);
    await this.publishViewerCount(auctionId);
  }

  private async unregisterViewer(auctionId: string, userId: string): Promise<void> {
    if (!userId.trim()) {
      return;
    }
    const redis = getAuctionRedis();
    if (!redis) {
      return;
    }
    const countKey = auctionViewerCountKey(auctionId, userId);
    const userSetKey = auctionViewerUsersKey(auctionId);
    const remaining = await redis.decr(countKey);
    if (remaining <= 0) {
      await redis.del(countKey);
      await redis.srem(userSetKey, userId);
    }
    await this.publishViewerCount(auctionId);
  }

  private async getViewerCount(auctionId: string): Promise<number> {
    const redis = getAuctionRedis();
    if (!redis) {
      return 0;
    }
    const n = await redis.scard(auctionViewerUsersKey(auctionId));
    return Number.isFinite(n) ? n : 0;
  }

  private async publishViewerCount(auctionId: string): Promise<void> {
    const pub = this.redisPublisher;
    if (!pub) {
      return;
    }
    const viewerCount = await this.getViewerCount(auctionId);
    await pub.publish(
      env.auctionBidBroadcastChannel,
      JSON.stringify({
        type: "auction_viewer_count_updated",
        auctionListingId: auctionId,
        viewerCount,
        updatedAt: new Date().toISOString()
      })
    );
  }

  private defaultIncrementFor(currentPriceUsd: string): string {
    const p = Number(currentPriceUsd);
    if (p <= 0.99) return "0.05";
    if (p <= 4.99) return "0.25";
    if (p <= 24.99) return "0.50";
    if (p <= 99.99) return "1.00";
    if (p <= 249.99) return "2.50";
    if (p <= 499.99) return "5.00";
    if (p <= 999.99) return "10.00";
    return "25.00";
  }
}
