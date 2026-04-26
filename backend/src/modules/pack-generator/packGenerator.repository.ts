import { getClient, query } from "../../db";
import type { CatalogCard, GeneratedPack } from "./packGenerator.types";

interface CatalogCardRow {
  id: string;
  card_id: string;
  name: string;
  card_set: string;
  image_url: string;
  rarity: string;
  market_value_usd: string;
}

export class PackGeneratorRepository {
  /** All catalog cards; tier only affects target pack value (price), not eligibility. */
  async findAllCatalogCards(): Promise<CatalogCard[]> {
    const result = await query<CatalogCardRow>(
      `
        SELECT
          c.id,
          c.card_id,
          c.name,
          c.card_set,
          c.image_url,
          c.rarity,
          c.market_value_usd::text AS market_value_usd
        FROM card c
        ORDER BY c.market_value_usd DESC, c.id ASC
      `
    );

    return result.rows.map((row) => ({
      id: row.id,
      cardId: row.card_id,
      name: row.name,
      cardSet: row.card_set,
      imageUrl: row.image_url,
      rarity: row.rarity,
      marketValueUsd: row.market_value_usd
    }));
  }

  async insertGeneratedPackBatch(
    tierName: string,
    priceUsd: number,
    packs: GeneratedPack[]
  ): Promise<void> {
    const client = await getClient();
    try {
      await client.query("BEGIN");

      for (const pack of packs) {
        // 1. Create the pack record
        const packRes = await client.query<{ id: string }>(
          `
            INSERT INTO packs (
              tier_name,
              price,
              cards_per_pack,
              available_count,
              start_time,
              rarity_weights
            )
            VALUES ($1, $2, $3, 1, NOW(), $4)
            RETURNING id
          `,
          [tierName, priceUsd, pack.cards.length, JSON.stringify({})]
        );

        const packId = packRes.rows[0].id;

        // 2. Link cards to the pack
        for (const gc of pack.cards) {
          await client.query(
            `
              INSERT INTO pack_card (pack_id, card_id)
              VALUES ($1, $2)
            `,
            [packId, gc.id]
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
