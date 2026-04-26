import Decimal from "decimal.js";
import { env } from "../config/env";
import { query } from "../db";
import { getCardMarketPriceUsd, publishCardPriceUpdated } from "../infra/redis/cardPriceStore";
import {
  fetchJustTcgPokemonCards,
  readFirstAvailableJustTcgPriceUsd
} from "../infra/tcgpricelookup/tcgPriceLookupClient";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalUsdString(n: number): string {
  return new Decimal(n).toDecimalPlaces(2).toFixed(2);
}

function redisMatchesCanonical(redisVal: string | null, canonical: string): boolean {
  if (redisVal == null || redisVal === "") {
    return false;
  }
  return new Decimal(redisVal).toDecimalPlaces(2).toFixed(2) === canonical;
}

/** Distinct external TCG `card_id` values for rows in pack catalog (`card` table). */
export async function listDistinctInventoryExternalCardIds(): Promise<string[]> {
  const res = await query<{ card_id: string }>(
    `
      SELECT DISTINCT TRIM(c.card_id) AS card_id
      FROM card c
      WHERE TRIM(c.card_id) <> ''
    `
  );
  return res.rows.map((r) => r.card_id.trim()).filter(Boolean);
}

/**
 * Fetches latest Sealed+Normal market USD from justtcg for inventory card ids, compares to canonical Redis
 * (`pullvault:card:market_usd:*`), and only then updates Redis + pub/sub so subscribers receive
 * `card_price_updated` when the value actually changed.
 */
export async function refreshInventoryCardPricesOnce(): Promise<{ checked: number; updated: number }> {
  const r = env.redisUrl.trim() || env.redisShardUrls[0] || "";
  if (!r) {
    return { checked: 0, updated: 0 };
  }
  const ids = await listDistinctInventoryExternalCardIds();
  const upstreamRows = await fetchJustTcgPokemonCards();
  const priceByExternalId = new Map<string, number>();
  for (const row of upstreamRows) {
    const externalId =
      typeof (row as { id?: unknown }).id === "string"
        ? (row as { id: string }).id.trim()
        : "";
    if (!externalId) continue;
    const price = readFirstAvailableJustTcgPriceUsd(row);
    if (price != null) {
      priceByExternalId.set(externalId, price);
    }
  }
  let updated = 0;

  for (const externalCardId of ids) {
    try {
      const latest = priceByExternalId.get(externalCardId) ?? null;
      if (latest === null) {
        continue;
      }
      const canonical = canonicalUsdString(latest);
      const current = await getCardMarketPriceUsd(externalCardId);
      if (redisMatchesCanonical(current, canonical)) {
        continue;
      }
      await publishCardPriceUpdated(externalCardId, canonical);
      updated += 1;
    } catch (err) {
      console.warn(`[inventoryCardPriceRefresh] skip card_id=${externalCardId}`, err);
    }
    const stagger = env.inventoryCardPriceRefreshStaggerMs;
    if (stagger > 0) {
      await sleep(stagger);
    }
  }

  if (ids.length > 0) {
    console.log(`[inventoryCardPriceRefresh] checked=${ids.length} updated=${updated}`);
  }

  return { checked: ids.length, updated };
}

export interface InventoryCardPriceRefreshHandles {
  stop: () => void;
}

/**
 * Runs `refreshInventoryCardPricesOnce` on an interval after an optional startup delay.
 * Disabled when `INVENTORY_CARD_PRICE_REFRESH_INTERVAL_MS` is 0 or unset API key / Redis.
 */
export function startInventoryCardPriceRefreshJob(): InventoryCardPriceRefreshHandles {
  const intervalMs = env.inventoryCardPriceRefreshIntervalMs;
  const hasRedis = Boolean(env.redisUrl.trim() || env.redisShardUrls[0]);

  if (intervalMs <= 0) {
    return { stop: () => {} };
  }
  if (!hasRedis) {
    console.warn(
      "[inventoryCardPriceRefresh] Job not started (need Redis URL/shard and interval > 0)."
    );
    return { stop: () => {} };
  }

  const tick = (): void => {
    void refreshInventoryCardPricesOnce().catch((err) => {
      console.error("[inventoryCardPriceRefresh] tick failed", err);
    });
  };

  const initialDelay = Math.max(0, env.inventoryCardPriceRefreshInitialDelayMs);
  let initialHandle: ReturnType<typeof setTimeout> | undefined;
  if (initialDelay === 0) {
    tick();
  } else {
    initialHandle = setTimeout(tick, initialDelay);
  }

  const intervalHandle = setInterval(tick, intervalMs);

  console.log(
    `[inventoryCardPriceRefresh] scheduled every ${intervalMs}ms (first run after ${initialDelay === 0 ? "0" : String(initialDelay)}ms)`
  );

  return {
    stop: () => {
      if (initialHandle) clearTimeout(initialHandle);
      clearInterval(intervalHandle);
    }
  };
}
