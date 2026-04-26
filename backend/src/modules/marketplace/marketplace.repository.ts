import type { PoolClient } from "pg";
import { query } from "../../db";
import type { MarketplaceListingRow } from "./marketplace.types";

export class MarketplaceRepository {
  async listPublicListings(): Promise<MarketplaceListingRow[]> {
    const result = await query<{
      user_card_id: string;
      seller_user_id: string;
      catalog_card_id: string;
      pack_id: string | null;
      card_id: string;
      name: string;
      card_set: string;
      image_url: string;
      rarity: string;
      asking_price: string;
      listed_at: Date;
    }>(
      `
        SELECT
          uc.id AS user_card_id,
          uc.user_id AS seller_user_id,
          c.id AS catalog_card_id,
          up.pack_id,
          TRIM(c.card_id) AS card_id,
          c.name,
          c.card_set,
          c.image_url,
          c.rarity,
          ml.listing_price_usd::text AS asking_price,
          ml.created_at AS listed_at
        FROM user_cards uc
        INNER JOIN marketplace_listings ml ON ml.user_card_id = uc.id
        INNER JOIN card c ON c.id = uc.card_id
        LEFT JOIN user_packs up ON up.id = uc.user_pack_id
        WHERE uc.selling_status = 'listed_for_sale'
        ORDER BY ml.created_at DESC
      `
    );
    return this.mapListingRows(result.rows);
  }

  /** Listed cards excluding a seller (e.g. signed-in viewer browsing others’ listings). */
  async listPublicListingsExcludingSeller(excludeSellerUserId: string): Promise<MarketplaceListingRow[]> {
    const result = await query<{
      user_card_id: string;
      seller_user_id: string;
      catalog_card_id: string;
      pack_id: string | null;
      card_id: string;
      name: string;
      card_set: string;
      image_url: string;
      rarity: string;
      asking_price: string;
      listed_at: Date;
    }>(
      `
        SELECT
          uc.id AS user_card_id,
          uc.user_id AS seller_user_id,
          c.id AS catalog_card_id,
          up.pack_id,
          TRIM(c.card_id) AS card_id,
          c.name,
          c.card_set,
          c.image_url,
          c.rarity,
          ml.listing_price_usd::text AS asking_price,
          ml.created_at AS listed_at
        FROM user_cards uc
        INNER JOIN marketplace_listings ml ON ml.user_card_id = uc.id
        INNER JOIN card c ON c.id = uc.card_id
        LEFT JOIN user_packs up ON up.id = uc.user_pack_id
        WHERE uc.selling_status = 'listed_for_sale'
          AND uc.user_id <> $1::uuid
        ORDER BY ml.created_at DESC
      `,
      [excludeSellerUserId]
    );
    return this.mapListingRows(result.rows);
  }

  private mapListingRows(
    rows: Array<{
      user_card_id: string;
      seller_user_id: string;
      catalog_card_id: string;
      pack_id: string | null;
      card_id: string;
      name: string;
      card_set: string;
      image_url: string;
      rarity: string;
      asking_price: string;
      listed_at: Date;
    }>
  ): MarketplaceListingRow[] {
    return rows.map((r) => ({
      userCardId: r.user_card_id,
      sellerUserId: r.seller_user_id,
      catalogCardId: r.catalog_card_id,
      packId: r.pack_id,
      cardId: r.card_id,
      name: r.name,
      cardSet: r.card_set,
      imageUrl: r.image_url,
      rarity: r.rarity,
      askingPriceUsd: r.asking_price,
      buyerPremiumRatePercent: "0.00",
      buyerPremiumUsd: "0.00",
      buyerTotalPriceUsd: r.asking_price,
      listedAt: r.listed_at.toISOString()
    }));
  }

  /** Lock a listing row and joined catalog price (read-only on `card`). */
  async lockListingWithPrice(
    client: PoolClient,
    userCardId: string
  ): Promise<{
    userCardId: string;
    sellerUserId: string;
    catalogCardId: string;
    packId: string | null;
    sellingStatus: string;
    marketValueUsd: string;
    listingPriceUsd: string;
  } | null> {
    const res = await client.query<{
      user_card_id: string;
      seller_user_id: string;
      catalog_card_id: string;
      pack_id: string | null;
      selling_status: string;
      market_value_usd: string;
      listing_price_usd: string;
    }>(
      `
        SELECT
          uc.id AS user_card_id,
          uc.user_id AS seller_user_id,
          uc.card_id AS catalog_card_id,
          up.pack_id,
          uc.selling_status,
          c.market_value_usd::text AS market_value_usd,
          ml.listing_price_usd::text AS listing_price_usd
        FROM user_cards uc
        INNER JOIN marketplace_listings ml ON ml.user_card_id = uc.id
        INNER JOIN card c ON c.id = uc.card_id
        LEFT JOIN user_packs up ON up.id = uc.user_pack_id
        WHERE uc.id = $1::uuid
        FOR UPDATE OF uc, ml
      `,
      [userCardId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    const r = res.rows[0];
    return {
      userCardId: r.user_card_id,
      sellerUserId: r.seller_user_id,
      catalogCardId: r.catalog_card_id,
      packId: r.pack_id,
      sellingStatus: r.selling_status,
      marketValueUsd: r.market_value_usd,
      listingPriceUsd: r.listing_price_usd
    };
  }

  async createMarketplacePurchaseUserPack(
    client: PoolClient,
    input: {
      buyerUserId: string;
      packId: string | null;
      purchasePriceUsd: string;
      totalCards: number;
      metadata: Record<string, unknown>;
    }
  ): Promise<{ id: string }> {
    const res = await client.query<{ id: string }>(
      `
        INSERT INTO user_packs (
          user_id,
          pack_id,
          drop_id,
          assignment_status,
          total_cards,
          purchase_price_usd,
          metadata
        )
        VALUES ($1::uuid, $2::uuid, NULL, 'revealed', $3::int, $4::numeric, $5::jsonb)
        RETURNING id
      `,
      [input.buyerUserId, input.packId, input.totalCards, input.purchasePriceUsd, JSON.stringify(input.metadata)]
    );
    return { id: res.rows[0].id };
  }

  async lockWalletRow(
    client: PoolClient,
    userId: string
  ): Promise<{ id: string; balance: string } | null> {
    const res = await client.query<{ id: string; balance: string }>(
      `
        SELECT id, balance::text AS balance
        FROM app_users
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [userId]
    );
    return res.rows[0] ?? null;
  }

  async updateUserBalance(client: PoolClient, userId: string, newBalance: string): Promise<void> {
    await client.query(`UPDATE app_users SET balance = $1::numeric WHERE id = $2::uuid`, [newBalance, userId]);
  }

  async deleteUserCard(client: PoolClient, userCardId: string): Promise<void> {
    await client.query(`DELETE FROM user_cards WHERE id = $1::uuid`, [userCardId]);
  }

  async insertMarketplaceOwnedCard(
    client: PoolClient,
    input: {
      buyerUserId: string;
      userPackId: string | null;
      catalogCardId: string;
      acquisitionPriceUsd: string;
    }
  ): Promise<{ id: string }> {
    const res = await client.query<{ id: string }>(
      `
        INSERT INTO user_cards (
          user_id,
          user_pack_id,
          card_id,
          acquisition_price,
          selling_status
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::numeric,
          'unlisted'
        )
        RETURNING id
      `,
      [input.buyerUserId, input.userPackId, input.catalogCardId, input.acquisitionPriceUsd]
    );
    return { id: res.rows[0].id };
  }

  async cardCountForPack(client: PoolClient, packId: string): Promise<number> {
    const res = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM pack_card
        WHERE pack_id = $1::uuid
      `,
      [packId]
    );
    return Number(res.rows[0]?.count ?? "0");
  }

  async lockUserCardForOwner(
    client: PoolClient,
    userCardId: string,
    ownerUserId: string
  ): Promise<{ id: string; sellingStatus: string } | null> {
    const res = await client.query<{
      id: string;
      selling_status: string;
    }>(
      `
        SELECT id, selling_status
        FROM user_cards
        WHERE id = $1::uuid AND user_id = $2::uuid
        FOR UPDATE
      `,
      [userCardId, ownerUserId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    const r = res.rows[0];
    return { id: r.id, sellingStatus: r.selling_status };
  }

  async setListedForSaleWithPrice(
    client: PoolClient,
    userCardId: string,
    listingPriceUsd: string
  ): Promise<void> {
    await client.query(
      `UPDATE user_cards SET selling_status = 'listed_for_sale' WHERE id = $1::uuid`,
      [userCardId]
    );
    await client.query(
      `
        INSERT INTO marketplace_listings (user_card_id, listing_price_usd)
        VALUES ($1::uuid, $2::numeric)
      `,
      [userCardId, listingPriceUsd]
    );
  }

  async clearListingForSale(client: PoolClient, userCardId: string): Promise<void> {
    await client.query(`DELETE FROM marketplace_listings WHERE user_card_id = $1::uuid`, [userCardId]);
    await client.query(
      `UPDATE user_cards SET selling_status = 'unlisted' WHERE id = $1::uuid`,
      [userCardId]
    );
  }

  async setListedForAuction(client: PoolClient, userCardId: string): Promise<void> {
    await client.query(`UPDATE user_cards SET selling_status = 'listed_for_auction' WHERE id = $1::uuid`, [
      userCardId
    ]);
  }
}
