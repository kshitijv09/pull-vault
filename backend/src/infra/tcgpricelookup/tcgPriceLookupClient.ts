import Decimal from "decimal.js";
import Redis from "ioredis";
import { env } from "../../config/env";
import { publishCardPriceUpdated } from "../redis/cardPriceStore";

const TCG_PRICE_LOOKUP_BASE = "https://api.tcgpricelookup.com/v1/cards";
/** Documented upstream search endpoint (same auth as single-card fetch). */
export const TCG_PRICE_LOOKUP_CARDS_SEARCH_URL = "https://api.tcgpricelookup.com/v1/cards/search";
export const JUSTTCG_POKEMON_CARDS_URL = "https://api.justtcg.com/v1/cards?game=pokemon";
const CACHE_KEY_PREFIX = "pullvault:tcgpricelookup:v1:nm:";

let priceCacheRedis: Redis | null | undefined;

function getPriceCacheRedis(): Redis | null {
  if (priceCacheRedis === undefined) {
    const url = env.redisUrl.trim() || env.redisShardUrls[0] || "";
    priceCacheRedis = url ? new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true }) : null;
  }
  return priceCacheRedis;
}

function nearMintCacheKey(externalCardId: string): string {
  return `${CACHE_KEY_PREFIX}${externalCardId.trim()}`;
}

interface TcgPriceLookupCardJson {
  prices?: {
    raw?: {
      near_mint?: {
        tcgplayer?: {
          market?: number | null;
        };
      };
    };
  };
}

interface JustTcgVariantJson {
  condition?: unknown;
  printing?: unknown;
  price?: unknown;
}

interface JustTcgCardJson {
  id?: unknown;
  variants?: unknown;
}

/** Reads near-mint TCGPlayer mid price from a card-shaped JSON object. */
export function readNearMintMidUsd(body: unknown): number | null {
  const parsed = body as any;
  const mid = parsed?.prices?.raw?.near_mint?.tcgplayer?.mid;
  if (mid === null || mid === undefined) {
    return null;
  }
  const n = typeof mid === "number" ? mid : Number(mid);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}

/** Reads near-mint TCGPlayer market from a card-shaped JSON object (single-card or search row). */
export function readNearMintMarketUsd(body: unknown): number | null {
  const parsed = body as TcgPriceLookupCardJson;
  const market = parsed?.prices?.raw?.near_mint?.tcgplayer?.market;
  if (market === null || market === undefined) {
    return null;
  }
  const n = typeof market === "number" ? market : Number(market);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}

/** Direct TCG Price Lookup HTTP call for near-mint mid price. */
export async function fetchNearMintMidUsdFromTcgApi(externalCardId: string): Promise<number | null> {
  const apiKey = env.tcgPriceLookupApiKey.trim();
  if (!apiKey) {
    return null;
  }

  const id = externalCardId.trim();
  if (!id) {
    return null;
  }

  const url = `${TCG_PRICE_LOOKUP_BASE}/${encodeURIComponent(id)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const body: unknown = await response.json();
    return readNearMintMidUsd(body);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Direct TCG Price Lookup HTTP call (does not use the short-lived near-mint Redis cache). */
export async function fetchNearMintMarketUsdFromTcgApi(externalCardId: string): Promise<number | null> {
  const apiKey = env.tcgPriceLookupApiKey.trim();
  if (!apiKey) {
    return null;
  }

  const id = externalCardId.trim();
  if (!id) {
    return null;
  }

  const url = `${TCG_PRICE_LOOKUP_BASE}/${encodeURIComponent(id)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const body: unknown = await response.json();
    return readNearMintMarketUsd(body);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Near-mint TCGPlayer market from TCG Price Lookup, cached in Redis per external `card_id` for a short TTL
 * so burst purchases of the same card type reuse one API response during a sale.
 */
function persistCanonicalCardPriceUsd(externalCardId: string, value: number): void {
  const asUsd = new Decimal(value).toDecimalPlaces(2).toFixed(2);
  void publishCardPriceUpdated(externalCardId.trim(), asUsd);
}

export async function fetchCardNearMintMarketUsd(externalCardId: string): Promise<number | null> {
  const apiKey = env.tcgPriceLookupApiKey.trim();
  if (!apiKey) {
    return null;
  }

  const id = externalCardId.trim();
  if (!id) {
    return null;
  }

  const redis = getPriceCacheRedis();
  const cacheKey = nearMintCacheKey(id);
  const ttl = env.tcgPriceLookupCacheTtlSeconds;

  let resolved: number | null = null;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null && cached !== undefined) {
        const n = Number(cached);
        if (Number.isFinite(n) && n >= 0) {
          resolved = n;
        }
      }
    } catch {
      // fall through to API
    }
  }

  if (resolved === null) {
    resolved = await fetchNearMintMarketUsdFromTcgApi(id);
    if (redis && resolved !== null) {
      try {
        await redis.set(cacheKey, String(resolved), "EX", ttl);
      } catch {
        // ignore cache write failures
      }
    }
  }

  if (resolved !== null) {
    persistCanonicalCardPriceUsd(id, resolved);
  }

  return resolved;
}

export function formatAcquisitionPriceUsd(value: number): string {
  return new Decimal(value).toDecimalPlaces(2).toFixed(2);
}

/** Reads first positive price from a justtcg card JSON row. */
export function readFirstAvailableJustTcgPriceUsd(body: unknown): number | null {
  const parsed = body as JustTcgCardJson;
  const variants = Array.isArray(parsed?.variants) ? (parsed.variants as JustTcgVariantJson[]) : [];

  for (const variant of variants) {
    const n = typeof variant.price === "number" ? variant.price : Number(variant.price);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }

  return null;
}

/**
 * Bulk fetch of Pokemon cards from justtcg.
 * Returns rows as provided by upstream (array).
 */
export async function fetchJustTcgPokemonCards(): Promise<unknown[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(JUSTTCG_POKEMON_CARDS_URL, {
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": process.env.JUSTTCG_API_KEY ?? "" },
      signal: controller.signal
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`justtcg cards fetch failed (${response.status})`);
    }
    if (Array.isArray(body)) {
      return body;
    }
    const wrapped = (body as { data?: unknown } | null)?.data;
    if (Array.isArray(wrapped)) {
      return wrapped;
    }
    throw new Error("Unexpected justtcg response shape (expected array or { data: [] })");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET https://api.tcgpricelookup.com/v1/cards/search with `x-api-key`.
 * Passes query keys through (e.g. `q`, `game`, `set`) per upstream contract.
 */
export async function fetchTcgPriceLookupCardSearch(params: Record<string, string>): Promise<unknown> {
  const apiKey = env.tcgPriceLookupApiKey.trim();
  if (!apiKey) {
    throw new Error("TCG_PRICE_LOOKUP_API_KEY is not configured.");
  }

  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const v = value?.trim();
    if (v) {
      usp.set(key, v);
    }
  }

  const qs = usp.toString();
  const url = `${TCG_PRICE_LOOKUP_CARDS_SEARCH_URL}${qs ? `?${qs}` : ""}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": apiKey
      },
      signal: controller.signal
    });

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const msg =
        typeof body === "object" && body !== null && "message" in body && typeof (body as { message: unknown }).message === "string"
          ? (body as { message: string }).message
          : `TCG Price Lookup search failed (${response.status})`;
      throw new Error(msg);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}
