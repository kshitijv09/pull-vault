import { getClient } from "../../db";
import { CreatePackInventoryInput } from "./inventory.types";
import { Pack } from "../drop/drop.types";

export class InventoryRepository {
  async bulkInsert(packs: Omit<Pack, "id" | "createdAt" | "updatedAt">[]): Promise<Pack[]> {
    if (packs.length === 0) return [];
    
    const client = await getClient();
    try {
      await client.query("BEGIN");
      
      const results: Pack[] = [];
      const insertQuery = `
        INSERT INTO packs (
          tier_name,
          price,
          cards_per_pack,
          available_count,
          start_time,
          rarity_weights
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      
      for (const pack of packs) {
        const res = await client.query(insertQuery, [
          pack.tierName,
          pack.priceUsd,
          pack.cardsPerPack,
          pack.availableCount,
          pack.dropStartsAt,
          pack.rarityWeights
        ]);
        
        const row = res.rows[0];
        results.push({
          id: row.id,
          tierName: row.tier_name,
          priceUsd: String(row.price),
          cardsPerPack: row.cards_per_pack,
          availableCount: row.available_count,
          dropStartsAt: row.start_time.toISOString(),
          rarityWeights: row.rarity_weights,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString()
        });
      }
      
      await client.query("COMMIT");
      return results;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
