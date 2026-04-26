import Redis from "ioredis";
import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";
import { env } from "../../config/env";
import type { ShardedRedisPackCounter } from "../../infra/redis/shardedRedisPackCounter";
import { PackAvailabilityRepository } from "./packAvailability.repository";
import type { PackPurchaseSuccessSocketPayload, TierAvailabilitySocketPayload } from "./packAvailability.types";
import jwt from "jsonwebtoken";
import { UserRepository } from "../user/user.repository";
import { getOrPrimeWalletBalance, userWalletBalanceKey } from "../../infra/redis/auctionWalletStore";

interface JwtPayload {
  id?: string;
}

function wsReady(client: WebSocket): boolean {
  return client.readyState === WebSocket.OPEN;
}

/** Same URL resolution as `ShardedRedisPackCounter`: shard list, else single `REDIS_URL`. */
function redisShardSubscriberUrls(): string[] {
  if (env.redisShardUrls.length > 0) {
    return [...new Set(env.redisShardUrls)];
  }
  const single = env.redisUrl.trim();
  return single ? [single] : [];
}

export class PackAvailabilitySocketServer {
  private readonly socketServer: WebSocketServer;
  private readonly repository: PackAvailabilityRepository;
  private readonly packCounter: ShardedRedisPackCounter | null;
  private readonly subscribers: Redis[];
  private readonly userRepository: UserRepository;
  private readonly wsUserByClient = new Map<WebSocket, string>();

  /**
   * @param socketServer — use `new WebSocketServer({ noServer: true })` and dispatch `upgrade` in `server.ts`
   *     so multiple WS paths can share one HTTP server (see `attachWebSocketUpgrades`).
   */
  constructor(socketServer: WebSocketServer, packCounter: ShardedRedisPackCounter | null) {
    this.socketServer = socketServer;
    this.repository = new PackAvailabilityRepository();
    this.packCounter = packCounter?.isConfigured() ? packCounter : null;
    this.userRepository = new UserRepository();

    this.subscribers = redisShardSubscriberUrls().map((url) => new Redis(url));
  }

  async start(): Promise<void> {
    this.socketServer.on("connection", async (client, req) => {
      let authedUserId = "";
      try {
        // Basic url search params check: /ws/pack-availability?token=xyz
        let token = "";
        const urlParams = new URLSearchParams(req.url?.split("?")[1] || "");
        token = urlParams.get("token") || "";

        if (!token) {
          // Alternatively check headers: req.headers.authorization
          const authHeader = req.headers.authorization || "";
          if (authHeader.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1];
          }
        }

        if (!token) {
          client.close(1008, "Token missing");
          return;
        }

        const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
        authedUserId = decoded.id?.trim() ?? "";
        if (!authedUserId) {
          client.close(1008, "Invalid or expired token");
          return;
        }
      } catch (error) {
        client.close(1008, "Invalid or expired token");
        return;
      }

      client.on("message", (data) => {
        void this.onClientMessage(client, authedUserId, data);
      });
      client.on("close", () => {
        this.wsUserByClient.delete(client);
      });
      client.on("error", () => {
        this.wsUserByClient.delete(client);
      });
      this.wsUserByClient.set(client, authedUserId);
      await this.sendSnapshotToClient(client);
    });

    if (this.subscribers.length === 0) {
      console.warn("[packAvailabilitySocketServer] Redis is not configured; live tier updates are disabled.");
      return;
    }

    const channel = env.packTierUpdatesChannel;
    for (const sub of this.subscribers) {
      await sub.subscribe(channel);
      sub.on("message", async (ch, message) => {
        if (ch !== channel) {
          return;
        }
        const parsed = this.parsePackEvent(message);
        if (parsed?.type === "pack_purchase_success") {
          this.sendPurchaseSuccessToUser(parsed);
          return;
        }
        await this.broadcastSnapshot();
      });
    }
  }

  private parsePackEvent(message: string): PackPurchaseSuccessSocketPayload | null {
    try {
      const parsed = JSON.parse(message) as Partial<PackPurchaseSuccessSocketPayload>;
      if (
        parsed?.type !== "pack_purchase_success" ||
        typeof parsed.userId !== "string" ||
        typeof parsed.dropId !== "string" ||
        typeof parsed.tierId !== "string" ||
        typeof parsed.packId !== "string" ||
        typeof parsed.userPackId !== "string" ||
        typeof parsed.userCardCount !== "number" ||
        typeof parsed.purchasedAt !== "string" ||
        !Array.isArray(parsed.cards)
      ) {
        return null;
      }
      return parsed as PackPurchaseSuccessSocketPayload;
    } catch {
      return null;
    }
  }

  private sendPurchaseSuccessToUser(payload: PackPurchaseSuccessSocketPayload): void {
    const encoded = JSON.stringify(payload);
    for (const client of this.socketServer.clients) {
      const userId = this.wsUserByClient.get(client);
      if (!userId || userId !== payload.userId) continue;
      if (!wsReady(client)) continue;
      client.send(encoded);
    }
  }

  private async sendSnapshotToClient(client: WebSocket): Promise<void> {
    try {
      const tiers = await this.loadTierSnapshot();
      const payload: TierAvailabilitySocketPayload = {
        type: "tier_availability_snapshot",
        tiers,
        updatedAt: new Date().toISOString()
      };
      if (wsReady(client)) {
        client.send(JSON.stringify(payload));
      }
    } catch (error) {
      console.error("[packAvailabilitySocketServer] failed to send initial snapshot", error);
    }
  }

  private async broadcastSnapshot(): Promise<void> {
    const tiers = await this.loadTierSnapshot();
    const payload: TierAvailabilitySocketPayload = {
      type: "tier_availability_snapshot",
      tiers,
      updatedAt: new Date().toISOString()
    };
    const encoded = JSON.stringify(payload);
    for (const client of this.socketServer.clients) {
      if (wsReady(client)) {
        client.send(encoded);
      }
    }
  }

  /**
   * Prefer live Redis per-pack `remaining` sums (updated by tier reserve/release Lua).
   * Falls back to DB when Redis pack counter is not configured.
   */
  private async loadTierSnapshot(): Promise<TierAvailabilitySocketPayload["tiers"]> {
    if (this.packCounter) {
      return this.packCounter.readTierAvailabilitySnapshots();
    }
    return this.repository.listTierAvailabilitySnapshot();
  }

  private async onClientMessage(client: WebSocket, authedUserId: string, raw: RawData): Promise<void> {
    try {
      const parsed = JSON.parse(String(raw)) as { type?: string; userId?: string };
      if (parsed.type !== "drop_user_init" || typeof parsed.userId !== "string") {
        return;
      }
      const userId = parsed.userId.trim();
      if (!userId || userId !== authedUserId) {
        client.close(1008, "User mismatch");
        return;
      }
      console.log("[packAvailabilitySocketServer] loading wallet from DB for drop init", {
        userId
      });
      const user = await this.userRepository.getById(userId);
      const wallet = await getOrPrimeWalletBalance(userWalletBalanceKey(userId), user.balance);
      console.log("[packAvailabilitySocketServer] wallet cache ready for drop init", {
        userId,
        walletSource: wallet?.source ?? "unavailable",
        cachedBalanceUsd: wallet?.balanceUsd ?? null
      });
    } catch {
      // ignore malformed frames / transient cache prime errors
    }
  }
}
