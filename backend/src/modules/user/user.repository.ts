import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { query } from "../../db";
import { AppError } from "../../shared/errors/AppError";
import { withTransaction } from "../../db/transaction";
import type { CreateUserInput, DepositFundsInput, UserCardsFilter, UserProfile } from "./user.types";

interface UserProfileRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  currency_code: string;
  balance: string;
  auction_balance: string;
  password_hash?: string;
  created_at: Date;
}

export class UserRepository {
  async getPublicProfilesByIds(userIds: string[]): Promise<Array<{ id: string; fullName: string }>> {
    if (userIds.length === 0) return [];
    const result = await query<{ id: string; full_name: string }>(
      `
        SELECT id, full_name
        FROM app_users
        WHERE id = ANY($1::uuid[])
      `,
      [userIds]
    );
    return result.rows.map((row) => ({ id: row.id, fullName: row.full_name }));
  }

  async create(input: CreateUserInput): Promise<UserProfile> {
    return withTransaction(async (client) => {
      const insertedUser = await client.query<{
        id: string;
      }>(
        `
          INSERT INTO app_users (email, password_hash, full_name, phone, city, country, balance)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id
        `,
        [input.email, input.passwordHash, input.fullName, input.phone ?? null, input.city ?? null, input.country ?? null, this.toMoneyString(input.initialBalance ?? "0")]
      );

      return this.getById(insertedUser.rows[0].id, client);
    });
  }

  async getById(userId: string, client?: PoolClient): Promise<UserProfile> {
    const executor = client ?? null;
    const queryStr = `
            SELECT
              id,
              email,
              full_name,
              phone,
              city,
              country,
              currency_code,
              balance,
              auction_balance,
              created_at
            FROM app_users
            WHERE id = $1
    `;
    const userResult = executor
      ? await executor.query<UserProfileRow>(queryStr, [userId])
      : await withTransaction(async (transactionClient) =>
          transactionClient.query<UserProfileRow>(queryStr, [userId])
        );

    if (userResult.rows.length === 0) {
      throw new AppError("User not found.", 404);
    }

    const user = userResult.rows[0];

    return {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      phone: user.phone,
      city: user.city,
      country: user.country,
      currencyCode: user.currency_code,
      balance: this.toMoneyString(user.balance),
      auctionBalance: this.toMoneyString(user.auction_balance ?? "0"),
      createdAt: user.created_at.toISOString()
    };
  }

  async depositFunds(input: DepositFundsInput): Promise<UserProfile> {
    return withTransaction(async (client) => {
      const walletResult = await client.query<{
        id: string;
        balance: string;
      }>(
        `
          SELECT
            id,
            balance
          FROM app_users
          WHERE id = $1
          FOR UPDATE
        `,
        [input.userId]
      );

      if (walletResult.rows.length === 0) {
        throw new AppError("User not found.", 404);
      }

      const user = walletResult.rows[0];
      const currentBalance = new Decimal(user.balance);
      const amount = new Decimal(input.amount);

      if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
        throw new AppError("Deposit amount must be greater than zero.", 400);
      }

      const nextBalance = this.toMoneyString(currentBalance.plus(amount));

      await client.query(
        `
          UPDATE app_users
          SET balance = $1
          WHERE id = $2
        `,
        [nextBalance, user.id]
      );

      const { updateCachedWalletBalanceIfExists, userWalletBalanceKey } = await import("../../infra/redis/auctionWalletStore");
      await updateCachedWalletBalanceIfExists(userWalletBalanceKey(input.userId), nextBalance);

      return this.getById(input.userId, client);
    });
  }

  async getByEmailWithPassword(email: string): Promise<{ profile: UserProfile; passwordHash: string } | null> {
    const userResult = await withTransaction(async (client) =>
      client.query<UserProfileRow>(
        `
          SELECT
            id,
            email,
            password_hash,
            full_name,
            phone,
            city,
            country,
            currency_code,
            balance,
            auction_balance,
            created_at
          FROM app_users
          WHERE email = $1
        `,
        [email]
      )
    );

    if (userResult.rows.length === 0) {
      return null;
    }

    const user = userResult.rows[0];

    const profile = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      phone: user.phone,
      city: user.city,
      country: user.country,
      currencyCode: user.currency_code,
      balance: this.toMoneyString(user.balance),
      auctionBalance: this.toMoneyString(user.auction_balance ?? "0"),
      createdAt: user.created_at.toISOString()
    };

    return { profile, passwordHash: user.password_hash || "" };
  }

  async getCards(userId: string, filter?: UserCardsFilter): Promise<any[]> {
    const conditions: string[] = ["uc.user_id = $1"];
    const params: unknown[] = [userId];
    let i = 2;

    if (filter?.rarity != null && filter.rarity.trim() !== "") {
      conditions.push(`c.rarity = $${i}`);
      params.push(filter.rarity.trim());
      i += 1;
    }
    if (filter?.cardSet != null && filter.cardSet.trim() !== "") {
      conditions.push(`c.card_set = $${i}`);
      params.push(filter.cardSet.trim());
      i += 1;
    }
    if (filter?.name != null && filter.name.trim() !== "") {
      conditions.push(`position(lower($${i}::text) in lower(c.name)) > 0`);
      params.push(filter.name.trim());
      i += 1;
    }

    const listingScope = filter?.collectionListing ?? "unlisted";
    if (listingScope === "unlisted") {
      conditions.push(`uc.selling_status = 'unlisted'`);
    } else if (listingScope === "listed_for_sale") {
      conditions.push(`uc.selling_status = 'listed_for_sale'`);
    } else if (listingScope === "listed_for_auction") {
      conditions.push(`uc.selling_status = 'listed_for_auction'`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await query(
      `
        SELECT
          uc.id AS "userCardId",
          c.id AS "catalogCardId",
          up.pack_id AS "packId",
          c.card_id AS "cardId",
          c.name,
          c.card_set AS "cardSet",
          c.image_url AS "imageUrl",
          c.rarity,
          c.market_value_usd::text AS "marketValueUsd",
          uc.acquisition_price::text AS "acquisitionPriceUsd",
          uc.selling_status AS "sellingStatus",
          ml.listing_price_usd::text AS "listingPriceUsd",
          uc.created_at AS "obtainedAt"
        FROM user_cards uc
        JOIN card c ON uc.card_id = c.id
        LEFT JOIN user_packs up ON up.id = uc.user_pack_id
        LEFT JOIN marketplace_listings ml ON ml.user_card_id = uc.id
        ${whereSql}
        ORDER BY uc.created_at DESC
      `,
      params
    );
    return result.rows;
  }

  async getOwnedCardFacets(userId: string): Promise<{ rarities: string[]; cardSets: string[] }> {
    const rarityResult = await query<{ rarity: string }>(
      `
        SELECT DISTINCT c.rarity
        FROM user_cards uc
        JOIN card c ON uc.card_id = c.id
        WHERE uc.user_id = $1
        ORDER BY c.rarity ASC
      `,
      [userId]
    );
    const setResult = await query<{ card_set: string }>(
      `
        SELECT DISTINCT c.card_set
        FROM user_cards uc
        JOIN card c ON uc.card_id = c.id
        WHERE uc.user_id = $1
        ORDER BY c.card_set ASC
      `,
      [userId]
    );
    return {
      rarities: rarityResult.rows.map((r) => r.rarity),
      cardSets: setResult.rows.map((r) => r.card_set)
    };
  }

  private toMoneyString(value: Decimal.Value): string {
    return new Decimal(value).toDecimalPlaces(2).toFixed(2);
  }
}
