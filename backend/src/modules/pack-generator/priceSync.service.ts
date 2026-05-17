import Decimal from "decimal.js";
import { query } from "../../db";
import {
  fetchJustTcgPokemonCards,
  readFirstAvailableJustTcgPriceUsd
} from "../../infra/tcgpricelookup/tcgPriceLookupClient";
import { CATALOG_PRICE_PACK_REGEN_RELATIVE_THRESHOLD, packGeneratorConfig } from "./packGenerator.config";

export class PriceSyncService {
  /**
   * Fetches justtcg Pokemon cards once, maps Sealed+Normal prices by external `card_id`,
   * and updates `card.market_value_usd`. Falls back to configured tier defaults when missing.
   *
   * @returns Catalog `card.id` values whose price moved by more than
   *          {@link CATALOG_PRICE_PACK_REGEN_RELATIVE_THRESHOLD} relative to the prior value.
   */
  async syncAllPrices(): Promise<string[]> {
    const cards = await query<{ id: string; card_id: string; rarity: string; market_value_usd: string }>(
      `
        SELECT id, card_id, rarity, market_value_usd::text AS market_value_usd
        FROM card
      `
    );

    console.log(`[PriceSyncService] Starting sync for ${cards.rows.length} cards.`);

    const significantChangeCardRowIds: string[] = [];

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

    for (const card of cards.rows) {
      try {
        const midPrice = priceByExternalId.get(card.card_id.trim()) ?? null;
        let finalPrice: number;

        if (midPrice !== null && midPrice !== undefined) {
          finalPrice = midPrice;
        } else {
          // Fallback logic based on rarity
          const normalizedRarity = card.rarity.toLowerCase();
          let rarityKey = "default";

          if (normalizedRarity.includes("starlight")) {
            rarityKey = "starlight_rare";
          } else if (normalizedRarity.includes("super")) {
            rarityKey = "super_rare";
          } else if (normalizedRarity.includes("rare")) {
            rarityKey = "rare";
          } else if (normalizedRarity.includes("uncommon")) {
            rarityKey = "uncommon";
          } else if (
            normalizedRarity.includes("common") ||
            normalizedRarity.includes("short print") ||
            normalizedRarity.includes("short_print")
          ) {
            rarityKey = "common";
          }

          finalPrice =
            (packGeneratorConfig as { fallbackMidPrices?: Record<string, number> }).fallbackMidPrices?.[
              rarityKey
            ] ?? packGeneratorConfig.fallbackMidPrices.default;
          console.log(`[PriceSyncService] API returned null for ${card.card_id}, using fallback: ${finalPrice} (rarity: ${card.rarity})`);
        }

        const oldUsd = new Decimal(card.market_value_usd);
        const newUsd = new Decimal(finalPrice);
        if (this.isRelativePriceChangeBeyondThreshold(oldUsd, newUsd)) {
          significantChangeCardRowIds.push(card.id);
        }

        await query(
          `UPDATE card SET market_value_usd = $1, updated_at = NOW() WHERE card_id = $2`,
          [finalPrice, card.card_id]
        );
      } catch (error) {
        console.error(`[PriceSyncService] Failed to sync price for card ${card.card_id}:`, error);
      }
    }

    console.log(
      `[PriceSyncService] Sync completed. Significant moves (>${CATALOG_PRICE_PACK_REGEN_RELATIVE_THRESHOLD.mul(100).toString()}%): ${significantChangeCardRowIds.length} card(s).`
    );
    return significantChangeCardRowIds;
  }

  private isRelativePriceChangeBeyondThreshold(oldUsd: Decimal, newUsd: Decimal): boolean {
    if (oldUsd.lessThanOrEqualTo(0)) {
      return !newUsd.equals(0);
    }
    return newUsd.minus(oldUsd).div(oldUsd).abs().greaterThan(CATALOG_PRICE_PACK_REGEN_RELATIVE_THRESHOLD);
  }
}
