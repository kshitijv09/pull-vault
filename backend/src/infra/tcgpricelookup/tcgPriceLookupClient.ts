import Decimal from "decimal.js";
import Redis from "ioredis";
import { env } from "../../config/env";
import { publishCardPriceUpdated } from "../redis/cardPriceStore";

const TCG_PRICE_LOOKUP_BASE = "https://api.tcgpricelookup.com/v1/cards";
/** Documented upstream search endpoint (same auth as single-card fetch). */
export const TCG_PRICE_LOOKUP_CARDS_SEARCH_URL = "https://api.tcgpricelookup.com/v1/cards/search";
/** Single-card lookup per JustTCG docs (`cardId` query). */
export const JUSTTCG_CARDS_BASE_URL = "https://api.justtcg.com/v1/cards";
/** JustTCG / TCG Price Lookup game filters used for all Pokemon catalog and pricing calls. */
export const JUSTTCG_POKEMON_GAMES = ["pokemon", "pokemon-japan"] as const;
export type JustTcgPokemonGame = (typeof JUSTTCG_POKEMON_GAMES)[number];
export const JUSTTCG_POKEMON_CARDS_URL = `${JUSTTCG_CARDS_BASE_URL}?game=pokemon`;
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

async function fetchNearMintMidUsdFromTcgApiForGame(
  externalCardId: string,
  game: JustTcgPokemonGame
): Promise<number | null> {
  const apiKey = env.tcgPriceLookupApiKey.trim();
  if (!apiKey) {
    return null;
  }

  const id = externalCardId.trim();
  if (!id) {
    return null;
  }

  const url = `${TCG_PRICE_LOOKUP_BASE}/${encodeURIComponent(id)}?game=${encodeURIComponent(game)}`;
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

/** Direct TCG Price Lookup HTTP call for near-mint mid price (`game=pokemon`, then `game=pokemon-japan`). */
export async function fetchNearMintMidUsdFromTcgApi(externalCardId: string): Promise<number | null> {
  for (const game of JUSTTCG_POKEMON_GAMES) {
    const price = await fetchNearMintMidUsdFromTcgApiForGame(externalCardId, game);
    if (price !== null) {
      return price;
    }
  }
  return null;
}

async function fetchNearMintMarketUsdFromTcgApiForGame(
  externalCardId: string,
  game: JustTcgPokemonGame
): Promise<number | null> {
  const apiKey = env.tcgPriceLookupApiKey.trim();
  if (!apiKey) {
    return null;
  }

  const id = externalCardId.trim();
  if (!id) {
    return null;
  }

  const url = `${TCG_PRICE_LOOKUP_BASE}/${encodeURIComponent(id)}?game=${encodeURIComponent(game)}`;
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

/** Direct TCG Price Lookup HTTP call (does not use the short-lived near-mint Redis cache). */
export async function fetchNearMintMarketUsdFromTcgApi(externalCardId: string): Promise<number | null> {
  for (const game of JUSTTCG_POKEMON_GAMES) {
    const price = await fetchNearMintMarketUsdFromTcgApiForGame(externalCardId, game);
    if (price !== null) {
      return price;
    }
  }
  return null;
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
function normalizeJustTcgSingleCardBody(body: unknown): unknown | null {
  if (body == null) {
    return null;
  }
  if (Array.isArray(body)) {
    return body.length > 0 ? body[0] : null;
  }
  if (typeof body === "object" && "data" in body) {
    const data = (body as { data: unknown }).data;
    if (Array.isArray(data)) {
      return data.length > 0 ? data[0] : null;
    }
    if (data != null && typeof data === "object") {
      return data;
    }
  }
  return body;
}

function justTcgApiKey(): string {
  return process.env.JUSTTCG_API_KEY?.trim() ?? "";
}

function parseJustTcgCardsListBody(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  const wrapped = (body as { data?: unknown } | null)?.data;
  if (Array.isArray(wrapped)) {
    return wrapped;
  }
  throw new Error("Unexpected justtcg response shape (expected array or { data: [] })");
}

function externalIdFromJustTcgRow(row: unknown): string | null {
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}

/**
 * GET https://api.justtcg.com/v1/cards?game=…
 * Uses JUSTTCG_API_KEY.
 */
async function fetchJustTcgCardsListForGame(game: JustTcgPokemonGame): Promise<unknown[]> {
  const apiKey = justTcgApiKey();
  if (!apiKey) {
    throw new Error("JUSTTCG_API_KEY is not configured.");
  }

  const url = `${JUSTTCG_CARDS_BASE_URL}?game=${encodeURIComponent(game)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": apiKey },
      signal: controller.signal
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`justtcg cards fetch failed for game=${game} (${response.status})`);
    }
    return parseJustTcgCardsListBody(body);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET https://api.justtcg.com/v1/cards?cardId=…&game=…
 * Uses JUSTTCG_API_KEY. Returns first positive variant price, or null.
 */
async function fetchJustTcgCardPriceUsdByCardIdForGame(
  externalCardId: string,
  game: JustTcgPokemonGame
): Promise<number | null> {
  const apiKey = justTcgApiKey();
  if (!apiKey) {
    return null;
  }
  const id = externalCardId.trim();
  if (!id) {
    return null;
  }
  const url = `${JUSTTCG_CARDS_BASE_URL}?cardId=${encodeURIComponent(id)}&game=${encodeURIComponent(game)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": apiKey },
      signal: controller.signal
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return null;
    }
    const row = normalizeJustTcgSingleCardBody(body);
    if (row == null) {
      return null;
    }
    return readFirstAvailableJustTcgPriceUsd(row);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJustTcgCardPriceUsdByCardId(externalCardId: string): Promise<number | null> {
  for (const game of JUSTTCG_POKEMON_GAMES) {
    const price = await fetchJustTcgCardPriceUsdByCardIdForGame(externalCardId, game);
    if (price !== null) {
      return price;
    }
  }
  return null;
}

/**
 * Bulk fetch of Pokemon cards from justtcg for `game=pokemon` and `game=pokemon-japan`.
 * First game wins when the same external id appears in both feeds.
 */
export async function fetchJustTcgPokemonCards(): Promise<unknown[]> {
  const mergedById = new Map<string, unknown>();
  for (const game of JUSTTCG_POKEMON_GAMES) {
    const rows = await fetchJustTcgCardsListForGame(game);
    for (const row of rows) {
      const externalId = externalIdFromJustTcgRow(row);
      if (!externalId || mergedById.has(externalId)) {
        continue;
      }
      mergedById.set(externalId, row);
    }
  }
  return Array.from(mergedById.values());
}

function tcgPriceLookupSearchRows(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }
  if (typeof body === "object" && body !== null) {
    const data = (body as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return data;
    }
    const results = (body as { results?: unknown }).results;
    if (Array.isArray(results)) {
      return results;
    }
  }
  return [];
}

function externalIdFromTcgPriceLookupRow(row: unknown): string | null {
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const candidate =
    "card_id" in row
      ? (row as { card_id: unknown }).card_id
      : "id" in row
        ? (row as { id: unknown }).id
        : null;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
}

async function fetchTcgPriceLookupCardSearchForGame(
  params: Record<string, string>,
  game: JustTcgPokemonGame
): Promise<unknown> {
  const apiKey = env.tcgPriceLookupApiKey.trim();
  if (!apiKey) {
    throw new Error("TCG_PRICE_LOOKUP_API_KEY is not configured.");
  }

  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "game") {
      continue;
    }
    const v = value?.trim();
    if (v) {
      usp.set(key, v);
    }
  }
  usp.set("game", game);

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
          : `TCG Price Lookup search failed for game=${game} (${response.status})`;
      throw new Error(msg);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET https://api.tcgpricelookup.com/v1/cards/search with `x-api-key`.
 * Passes query keys through (e.g. `q`, `set`). When `game` is omitted, queries
 * `game=pokemon` and `game=pokemon-japan` and merges unique rows by external id.
 */
export async function fetchTcgPriceLookupCardSearch(params: Record<string, string>): Promise<unknown> {
  const explicitGame = params.game?.trim();
  if (explicitGame) {
    return fetchTcgPriceLookupCardSearchForGame(params, explicitGame as JustTcgPokemonGame);
  }

  const mergedById = new Map<string, unknown>();
  for (const game of JUSTTCG_POKEMON_GAMES) {
    const body = await fetchTcgPriceLookupCardSearchForGame(params, game);
    for (const row of tcgPriceLookupSearchRows(body)) {
      const externalId = externalIdFromTcgPriceLookupRow(row);
      if (!externalId || mergedById.has(externalId)) {
        continue;
      }
      mergedById.set(externalId, row);
    }
  }

  return Array.from(mergedById.values());
}
