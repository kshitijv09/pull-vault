import type { PoolClient } from "pg";
import { getClient, query } from "../../db";
import { PACK_INVENTORY_STATUS } from "../../shared/constants/packInventoryStatus.constants";
import type { CatalogCard, GeneratedPack } from "./packGenerator.types";

export interface PackTemplateRow {
  id: string;
  tierName: string;
  priceText: string;
  cardsPerPack: number;
}

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

  /** Load `packs` rows for in-place card regeneration. */
  async findPacksByIds(ids: string[]): Promise<PackTemplateRow[]> {
    if (ids.length === 0) return [];
    const result = await query<{
      id: string;
      tier_name: string;
      price: string;
      cards_per_pack: number;
    }>(
      `
        SELECT id, tier_name, price::text AS price, cards_per_pack
        FROM packs
        WHERE id = ANY($1::uuid[])
      `,
      [ids]
    );
    return result.rows.map((row) => ({
      id: row.id,
      tierName: row.tier_name,
      priceText: row.price,
      cardsPerPack: row.cards_per_pack
    }));
  }

  /**
   * `packs.id` templates that contain any of the given catalog `card.id` rows and are safe to regenerate:
   * no `pack_inventory` row is `reserved`, and none is `in_drop_sale` on a **`live`** drop.
   */
  async findPackTemplateIdsEligibleForRegeneration(cardRowIds: string[]): Promise<string[]> {
    if (cardRowIds.length === 0) return [];
    const result = await query<{ pack_id: string }>(
      `
        SELECT DISTINCT pc.pack_id
        FROM pack_card pc
        WHERE pc.card_id = ANY($1::uuid[])
          AND NOT EXISTS (
            SELECT 1
            FROM pack_inventory pi
            INNER JOIN drops d ON d.id = pi.drop_id
            WHERE pi.pack_id = pc.pack_id
              AND pi.status = $2
              AND LOWER(d.status) = 'live'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pack_inventory pi
            WHERE pi.pack_id = pc.pack_id
              AND pi.status = $3
          )
      `,
      [cardRowIds, PACK_INVENTORY_STATUS.IN_DROP_SALE, PACK_INVENTORY_STATUS.RESERVED]
    );
    return result.rows.map((r) => r.pack_id);
  }

  /**
   * Removes all `pack_card` rows for a template and inserts new links; updates `cards_per_pack`.
   * Caller must run inside a transaction.
   */
  async replacePackCardLinks(
    client: PoolClient,
    packId: string,
    catalogCardIds: string[],
    cardsPerPack: number
  ): Promise<void> {
    await client.query(`DELETE FROM pack_card WHERE pack_id = $1::uuid`, [packId]);
    for (const cardId of catalogCardIds) {
      await client.query(
        `
          INSERT INTO pack_card (pack_id, card_id)
          VALUES ($1::uuid, $2::uuid)
        `,
        [packId, cardId]
      );
    }
    await client.query(
      `
        UPDATE packs
        SET cards_per_pack = $2, updated_at = NOW()
        WHERE id = $1::uuid
      `,
      [packId, cardsPerPack]
    );
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
