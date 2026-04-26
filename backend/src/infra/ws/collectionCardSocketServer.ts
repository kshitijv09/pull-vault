import { randomUUID } from "node:crypto";
import os from "node:os";
import type { IncomingMessage } from "node:http";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import type { RawData } from "ws";
import { WebSocketServer, WebSocket } from "ws";
import { env } from "../../config/env";
import { query } from "../../db";
import {
  addCardSocketWatcher,
  getManyCardMarketPricesUsd,
  removeCardSocketWatcher
} from "../redis/cardPriceStore";

const INSTANCE_ID = `${os.hostname().slice(0, 48)}-${process.pid}-${randomUUID().slice(0, 8)}`;

type JwtPayload = { id: string; email: string };

interface ClientMeta {
  userId: string;
  sessionKey: string;
  externalCardIds: Set<string>;
}

async function filterOwnedExternalCardIds(userId: string, externalCardIds: string[]): Promise<string[]> {
  const uniq = [...new Set(externalCardIds.map((x) => String(x).trim()).filter(Boolean))];
  if (uniq.length === 0) {
    return [];
  }
  const res = await query<{ card_id: string }>(
    `
      SELECT DISTINCT TRIM(c.card_id) AS card_id
      FROM user_cards uc
      INNER JOIN card c ON c.id = uc.card_id
      WHERE uc.user_id = $1::uuid AND TRIM(c.card_id) = ANY($2::text[])
    `,
    [userId, uniq]
  );
  return res.rows.map((r) => r.card_id.trim());
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

export class CollectionCardSocketServer {
  private readonly wss: WebSocketServer;
  private readonly connectionMeta = new Map<WebSocket, ClientMeta>();
  private readonly cardIdToSockets = new Map<string, Set<WebSocket>>();
  private redisSubscriber: Redis | null = null;

  /** @param wss — `new WebSocketServer({ noServer: true })`; upgrade routed in `server.ts`. */
  constructor(wss: WebSocketServer) {
    this.wss = wss;
  }

  async start(): Promise<void> {
    const url = env.redisUrl.trim() || env.redisShardUrls[0] || "";
    if (url) {
      this.redisSubscriber = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true });
      await this.redisSubscriber.subscribe(env.cardPriceBroadcastChannel);
      this.redisSubscriber.on("message", (_channel, message) => {
        this.onPriceBroadcast(message);
      });
    } else {
      console.warn("[collectionCardSocketServer] Redis not configured; card price pub/sub disabled.");
    }

    this.wss.on("connection", (ws, req) => {
      void this.onConnection(ws, req);
    });

    console.log("[collectionCardSocketServer] listening at /ws/collection");
  }

  private onPriceBroadcast(raw: string): void {
    let payload: { type?: string; cardId?: string; priceUsd?: string; updatedAt?: string };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return;
    }
    if (payload.type !== "card_price_updated" || !payload.cardId) {
      return;
    }
    const cardId = payload.cardId.trim();
    const set = this.cardIdToSockets.get(cardId);
    if (!set || set.size === 0) {
      return;
    }
    const encoded = JSON.stringify(payload);
    for (const client of set) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(encoded);
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
        throw new Error("missing sub");
      }
    } catch {
      ws.close(1008, "Invalid or expired token");
      return;
    }

    ws.on("message", (data) => {
      void this.onClientMessage(ws, userId, data);
    });

    ws.on("close", () => {
      this.detachSocket(ws);
    });

    ws.on("error", () => {
      this.detachSocket(ws);
    });
  }

  private detachSocket(ws: WebSocket): void {
    const meta = this.connectionMeta.get(ws);
    if (!meta) {
      return;
    }
    for (const cardId of meta.externalCardIds) {
      void removeCardSocketWatcher(cardId, meta.sessionKey);
      const set = this.cardIdToSockets.get(cardId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          this.cardIdToSockets.delete(cardId);
        }
      }
    }
    this.connectionMeta.delete(ws);
  }

  private async onClientMessage(ws: WebSocket, userId: string, data: RawData): Promise<void> {
    let parsed: { type?: string; cardIds?: unknown };
    try {
      const text = typeof data === "string" ? data : data.toString("utf8");
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      return;
    }

    if (parsed.type !== "subscribe_cards" || !Array.isArray(parsed.cardIds)) {
      return;
    }

    const requested = parsed.cardIds.filter((x): x is string => typeof x === "string");
    const allowed = await filterOwnedExternalCardIds(userId, requested);

    this.detachSocket(ws);

    const sessionKey = `${INSTANCE_ID}:${randomUUID()}`;
    const meta: ClientMeta = { userId, sessionKey, externalCardIds: new Set(allowed) };
    this.connectionMeta.set(ws, meta);

    for (const cardId of allowed) {
      await addCardSocketWatcher(cardId, sessionKey);
      let set = this.cardIdToSockets.get(cardId);
      if (!set) {
        set = new Set();
        this.cardIdToSockets.set(cardId, set);
      }
      set.add(ws);
    }

    const prices = await getManyCardMarketPricesUsd(allowed);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "card_prices_snapshot",
          prices,
          subscribedCardIds: allowed,
          updatedAt: new Date().toISOString()
        })
      );
    }
  }
}
