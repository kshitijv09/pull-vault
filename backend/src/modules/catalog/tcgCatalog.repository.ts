import { getClient, query } from "../../db";

export class TcgCatalogRepository {
  async findExistingExternalCardIds(externalCardIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(externalCardIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) {
      return new Set();
    }

    const res = await query<{ card_id: string }>(
      `
        SELECT card_id
        FROM card
        WHERE card_id = ANY($1::text[])
      `,
      [ids]
    );
    return new Set(res.rows.map((r) => r.card_id.trim()));
  }

  async insertCatalogCards(
    rows: Array<{
      externalCardId: string;
      name: string;
      cardSet: string;
      imageUrl: string;
      rarity: string;
      marketValueUsd: string;
    }>
  ): Promise<
    Array<{
      id: string;
      card_id: string;
      name: string;
      card_set: string;
      image_url: string;
      rarity: string;
      market_value_usd: string;
    }>
  > {
    if (rows.length === 0) {
      return [];
    }

    const client = await getClient();
    try {
      await client.query("BEGIN");
      const inserted: Array<{
        id: string;
        card_id: string;
        name: string;
        card_set: string;
        image_url: string;
        rarity: string;
        market_value_usd: string;
      }> = [];

      for (const row of rows) {
        const upsert = await client.query<{
          id: string;
          card_id: string;
          name: string;
          card_set: string;
          image_url: string;
          rarity: string;
          market_value_usd: string | number;
        }>(
          `
            INSERT INTO card (
              card_id,
              name,
              card_set,
              image_url,
              rarity,
              market_value_usd
            )
            VALUES ($1, $2, $3, $4, $5, $6::numeric)
            ON CONFLICT (card_id) DO NOTHING
            RETURNING id, card_id, name, card_set, image_url, rarity, market_value_usd
          `,
          [
            row.externalCardId,
            row.name,
            row.cardSet,
            row.imageUrl,
            row.rarity,
            row.marketValueUsd
          ]
        );

        const card = upsert.rows[0];
        if (!card) {
          continue;
        }

        inserted.push({
          id: card.id,
          card_id: card.card_id,
          name: card.name,
          card_set: card.card_set,
          image_url: card.image_url,
          rarity: card.rarity,
          market_value_usd: String(card.market_value_usd)
        });
      }

      await client.query("COMMIT");
      return inserted;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
