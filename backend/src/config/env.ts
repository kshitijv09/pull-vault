import "dotenv/config";

const requiredEnv = ["PORT", "CORS_ORIGIN", "JWT_SECRET"] as const;

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

/** Comma-separated Redis connection strings; each URL is one shard for pack counters. */
const redisShardUrlsRaw = process.env.REDIS_SHARD_URLS ?? process.env.REDIS_URL ?? "";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN as string,
  supabaseDbUrl: process.env.SUPABASE_DB_URL ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  /** Non-empty list enables sharded pack counter Lua path. */
  redisShardUrls: redisShardUrlsRaw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0),
  packPurchaseQueueName: process.env.PACK_PURCHASE_QUEUE_NAME ?? "pack_purchases",
  packTierUpdatesChannel: process.env.PACK_TIER_UPDATES_CHANNEL ?? "pack_tier_updates",
  /** Pub/sub: `publishCardPriceUpdated` — each API instance forwards to subscribed collection sockets. */
  cardPriceBroadcastChannel: process.env.CARD_PRICE_BROADCAST_CHANNEL ?? "pullvault:card_price_updates",
  /** Pub/sub for live auction bid updates. */
  auctionBidBroadcastChannel:
    process.env.AUCTION_BID_BROADCAST_CHANNEL ?? "pullvault:auction_bid_updates",
  jwtSecret: process.env.JWT_SECRET as string,
  /** TCG Price Lookup — used for per-card acquisition_price at pack purchase. */
  tcgPriceLookupApiKey: process.env.TCG_PRICE_LOOKUP_API_KEY ?? "",
  /**
   * Near-mint market cache TTL (seconds). Kept short so sale-time prices stay fresh; repeat card types reuse Redis within the window.
   */
  tcgPriceLookupCacheTtlSeconds: (() => {
    const raw = Number(process.env.TCG_PRICE_LOOKUP_CACHE_TTL_SECONDS ?? 30);
    if (!Number.isFinite(raw)) return 30;
    return Math.min(120, Math.max(5, Math.floor(raw)));
  })(),
  /**
   * How often to re-fetch TCG near-mint prices for every distinct `card.card_id` in catalog inventory,
   * compare to canonical Redis `pullvault:card:market_usd:*`, and publish `card_price_updated` only when changed.
   * Set to `0` to disable.
   */
  inventoryCardPriceRefreshIntervalMs: (() => {
    const raw = Number(process.env.INVENTORY_CARD_PRICE_REFRESH_INTERVAL_MS ?? 300_000);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return Math.floor(raw);
  })(),
  /** Delay before the first inventory price refresh tick (ms). */
  inventoryCardPriceRefreshInitialDelayMs: (() => {
    const raw = Number(process.env.INVENTORY_CARD_PRICE_REFRESH_INITIAL_DELAY_MS ?? 15_000);
    if (!Number.isFinite(raw) || raw < 0) return 15_000;
    return Math.floor(raw);
  })(),
  /** Pause between per-card TCG API calls during one refresh pass (rate limiting). */
  inventoryCardPriceRefreshStaggerMs: (() => {
    const raw = Number(process.env.INVENTORY_CARD_PRICE_REFRESH_STAGGER_MS ?? 200);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return Math.min(5000, Math.floor(raw));
  })(),
  /**
   * How often to insert `user_portfolio_snapshots` for every user (`0` disables).
   * Default 24 hours.
   */
  portfolioSnapshotIntervalMs: (() => {
    const raw = Number(process.env.PORTFOLIO_SNAPSHOT_INTERVAL_MS ?? 86_400_000);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return Math.floor(raw);
  })(),
  portfolioSnapshotInitialDelayMs: (() => {
    const raw = Number(process.env.PORTFOLIO_SNAPSHOT_INITIAL_DELAY_MS ?? 60_000);
    if (!Number.isFinite(raw) || raw < 0) return 60_000;
    return Math.floor(raw);
  })()
};
