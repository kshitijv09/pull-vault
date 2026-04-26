import { query } from "../../db";
import {
  fetchJustTcgPokemonCards,
  readFirstAvailableJustTcgPriceUsd
} from "../../infra/tcgpricelookup/tcgPriceLookupClient";
import { packGeneratorConfig } from "./packGenerator.config";

export class PriceSyncService {
  /**
   * Fetches justtcg Pokemon cards once, maps Sealed+Normal prices by external `card_id`,
   * and updates `card.market_value_usd`. Falls back to configured tier defaults when missing.
   */
  async syncAllPrices(): Promise<void> {
    const cards = await query<{ card_id: string; rarity: string }>(
      `
        SELECT card_id, rarity
        FROM card
      `
    );

    console.log(`[PriceSyncService] Starting sync for ${cards.rows.length} cards.`);

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
          } else if (normalizedRarity.includes("common") || normalizedRarity.includes("short print") || normalizedRarity.includes("short_print")) {
            rarityKey = "common";
          }

          finalPrice = (packGeneratorConfig as any).fallbackMidPrices[rarityKey] ?? packGeneratorConfig.fallbackMidPrices.default;
          console.log(`[PriceSyncService] API returned null for ${card.card_id}, using fallback: ${finalPrice} (rarity: ${card.rarity})`);
        }

        await query(
          `UPDATE card SET market_value_usd = $1, updated_at = NOW() WHERE card_id = $2`,
          [finalPrice, card.card_id]
        );
      } catch (error) {
        console.error(`[PriceSyncService] Failed to sync price for card ${card.card_id}:`, error);
      }
    }

    console.log(`[PriceSyncService] Sync completed.`);
  }
}
