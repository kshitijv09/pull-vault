import Redis from "ioredis";
import { env } from "../../config/env";

let commandRedis: Redis | null | undefined;

/** Primary Redis for card market strings + watcher sets + pub/sub (use one URL in multi-shard setups). */
export function getCardPriceRedis(): Redis | null {
  if (commandRedis === undefined) {
    const url = env.redisUrl.trim() || env.redisShardUrls[0] || "";
    commandRedis = url ? new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true }) : null;
  }
  return commandRedis;
}

/** Canonical near-mint / market USD for catalog `card.card_id` (external id). */
export function cardMarketPriceKey(externalCardId: string): string {
  return `pullvault:card:market_usd:${externalCardId.trim()}`;
}

/** Redis SET of logical socket session keys watching this card id (cross-process registry). */
export function cardSocketWatchersKey(externalCardId: string): string {
  return `pullvault:card:sockets:${externalCardId.trim()}`;
}

export async function setCardMarketPriceUsd(externalCardId: string, priceUsd: string): Promise<void> {
  const r = getCardPriceRedis();
  if (!r) return;
  await r.set(cardMarketPriceKey(externalCardId), priceUsd);
}

export async function getCardMarketPriceUsd(externalCardId: string): Promise<string | null> {
  const r = getCardPriceRedis();
  if (!r) return null;
  const id = externalCardId.trim();
  if (!id) return null;
  const v = await r.get(cardMarketPriceKey(id));
  return v != null && v !== "" ? v : null;
}

export async function getManyCardMarketPricesUsd(
  externalCardIds: string[]
): Promise<Record<string, string>> {
  const r = getCardPriceRedis();
  const out: Record<string, string> = {};
  if (!r || externalCardIds.length === 0) {
    return out;
  }
  const trimmed = externalCardIds.map((id) => id.trim()).filter(Boolean);
  if (trimmed.length === 0) return out;
  const keys = trimmed.map(cardMarketPriceKey);
  const vals = await r.mget(...keys);
  trimmed.forEach((id, i) => {
    const v = vals[i];
    if (v != null && v !== "") {
      out[id] = v;
    }
  });
  return out;
}

export async function addCardSocketWatcher(externalCardId: string, sessionKey: string): Promise<void> {
  const r = getCardPriceRedis();
  if (!r) return;
  await r.sadd(cardSocketWatchersKey(externalCardId), sessionKey);
}

export async function removeCardSocketWatcher(externalCardId: string, sessionKey: string): Promise<void> {
  const r = getCardPriceRedis();
  if (!r) return;
  await r.srem(cardSocketWatchersKey(externalCardId), sessionKey);
}

/** Persists price and notifies all app instances via pub/sub (each instance pushes to local WebSockets). */
export async function publishCardPriceUpdated(externalCardId: string, priceUsd: string): Promise<void> {
  const r = getCardPriceRedis();
  if (!r) return;
  const id = externalCardId.trim();
  if (!id) return;
  await setCardMarketPriceUsd(id, priceUsd);
  const payload = JSON.stringify({
    type: "card_price_updated",
    cardId: id,
    priceUsd,
    updatedAt: new Date().toISOString()
  });
  await r.publish(env.cardPriceBroadcastChannel, payload);
}
