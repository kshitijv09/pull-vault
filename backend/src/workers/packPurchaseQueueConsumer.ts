import Redis from "ioredis";
import Decimal from "decimal.js";
import { query } from "../db";
import { withTransaction } from "../db/transaction";
import type { PoolClient } from "pg";
import { env } from "../config/env";
import {
  fetchCardNearMintMarketUsd,
  formatAcquisitionPriceUsd
} from "../infra/tcgpricelookup/tcgPriceLookupClient";
import {
  creditCachedWalletBalance,
  debitCachedWalletBalanceIfSufficient,
  getOrPrimeWalletBalance,
  setCachedWalletBalance,
  userWalletBalanceKey
} from "../infra/redis/auctionWalletStore";
import type { PackPurchaseQueuePayload } from "../modules/pack-queue/packQueue.types";
import { recordCompanyEarning } from "../modules/analytics/earningsLedger.repository";
import { AppError } from "../shared/errors/AppError";

interface PackRow {
  inventory_id: string;
  pack_type_id: string;
  drop_id: string | null;
  price: string;
  cards_per_pack: number;
  inventory_status: string;
}

interface CatalogCardRow {
  id: string;
  card_id: string;
  name: string;
  card_set: string;
  rarity: string;
  market_value_usd: string;
  image_url: string | null;
}

/**
 * For each catalog `card` row, resolves acquisition_price: TCG Price Lookup near_mint.market when possible,
 * else `card.market_value_usd`.
 */
async function resolveAcquisitionPricesByCatalogCardId(
  cards: CatalogCardRow[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (cards.length === 0) {
    return result;
  }

  const priceByExternalId = new Map<string, number>();

  if (env.tcgPriceLookupApiKey.trim()) {
    const uniqueExternalIds = [...new Set(cards.map((c) => c.card_id.trim()).filter(Boolean))];
    await Promise.all(
      uniqueExternalIds.map(async (externalId) => {
        const market = await fetchCardNearMintMarketUsd(externalId);
        if (market !== null) {
          priceByExternalId.set(externalId, market);
        }
      })
    );
  }

  for (const row of cards) {
    const externalId = row.card_id.trim();
    const fromApi = externalId ? priceByExternalId.get(externalId) : undefined;
    const fallback = new Decimal(row.market_value_usd).toDecimalPlaces(2).toNumber();
    const resolved = fromApi !== undefined ? fromApi : fallback;
    result.set(row.id, formatAcquisitionPriceUsd(resolved));
  }

  return result;
}

function assertNonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function parsePayload(content: string): PackPurchaseQueuePayload {
  const parsed = JSON.parse(content) as Partial<PackPurchaseQueuePayload>;

  const userId = assertNonEmptyString(parsed.userId);
  const tierId = assertNonEmptyString(parsed.tierId);
  const dropId = assertNonEmptyString(parsed.dropId);
  const packId = assertNonEmptyString(parsed.packId);

  if (!userId || !tierId || !dropId || !packId) {
    throw new AppError("Queue message missing required fields (userId, tierId, dropId, packId).", 400);
  }

  return {
    userId,
    tierId,
    dropId,
    packId,
    requestedAt: assertNonEmptyString(parsed.requestedAt) || new Date().toISOString()
  };
}

let cachedInitialSellingStatus: string | null = null;

async function resolveInitialSellingStatus(client: PoolClient): Promise<string> {
  if (cachedInitialSellingStatus) {
    return cachedInitialSellingStatus;
  }

  const constraint = await client.query<{ def: string }>(
    `
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = 'user_cards_selling_status_check'
      LIMIT 1
    `
  );
  const def = constraint.rows[0]?.def ?? "";
  const values = [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const allowed = new Set(values);
  const preferred = ["unlisted", "listed_for_sale", "listed"];
  const picked = preferred.find((v) => allowed.has(v)) ?? "unlisted";
  cachedInitialSellingStatus = picked;
  return picked;
}

async function processPurchase(
  payload: PackPurchaseQueuePayload,
  queueMessageId: string | null
): Promise<{
  userPackId: string;
  userCardCount: number;
  purchasedCards: Array<{
    cardId: string;
    name: string;
    cardSet: string;
    rarity: string;
    marketValueUsd: string;
    imageUrl: string;
  }>;
}> {
  let debitedRedisKey: string | null = null;
  let debitedAmountUsd: string | null = null;
  const committed = await withTransaction(async (client) => {
    const packResult = await client.query<PackRow>(
      `
        SELECT
          pi.id AS inventory_id,
          p.id AS pack_type_id,
          pi.drop_id,
          p.price::text AS price,
          p.cards_per_pack,
          pi.status AS inventory_status
        FROM pack_inventory pi
        INNER JOIN packs p ON p.id = pi.pack_id
        WHERE pi.id = $1::uuid
        FOR UPDATE OF pi, p
      `,
      [payload.packId]
    );

    if (packResult.rows.length === 0) {
      throw new AppError("Pack tier not found.", 404);
    }

    const pack = packResult.rows[0];
    const catalogCardsResult = await client.query<CatalogCardRow>(
      `
        SELECT
          c.id,
          c.card_id,
          c.name,
          c.card_set,
          c.rarity,
          c.market_value_usd::text AS market_value_usd,
          c.image_url
        FROM pack_card pc
        INNER JOIN card c ON c.id = pc.card_id
        WHERE pc.pack_id = $1::uuid
        ORDER BY c.id
      `,
      [pack.pack_type_id]
    );

    const acquisitionPriceByCatalogCardId = await resolveAcquisitionPricesByCatalogCardId(
      catalogCardsResult.rows
    );
    const totalCatalogCardValueUsd = catalogCardsResult.rows.reduce(
      (sum, row) => sum.plus(new Decimal(row.market_value_usd)),
      new Decimal(0)
    );

    if (pack.drop_id !== payload.dropId) {
      throw new AppError("dropId does not match the pack tier.", 400);
    }
    if (pack.inventory_status !== "available") {
      throw new AppError("Pack inventory is not available.", 409);
    }

    const walletResult = await client.query<{
        id: string;
        balance: string;
      }>(
      `
        SELECT
          id,
          balance::text AS balance
        FROM app_users
        WHERE id = $1
        FOR UPDATE
      `,
      [payload.userId]
    );

    if (walletResult.rows.length === 0) {
      throw new AppError("User not found.", 404);
    }

    const userRow = walletResult.rows[0];
    const currentBalance = new Decimal(userRow.balance);
    const packPrice = new Decimal(pack.price);

    if (currentBalance.lessThan(packPrice)) {
      throw new AppError("Insufficient wallet balance for selected tier.", 409);
    }

    const packPriceUsd = packPrice.toDecimalPlaces(2).toFixed(2);
    const walletKey = userWalletBalanceKey(payload.userId);
    // Force sync Redis with the locked DB balance to avoid debiting from a stale cache.
    await setCachedWalletBalance(walletKey, userRow.balance);

    const debitResult = await debitCachedWalletBalanceIfSufficient(walletKey, packPriceUsd);
    if (!debitResult.ok) {
      if (debitResult.reason === "insufficient") {
        throw new AppError("Insufficient wallet balance for selected tier.", 409);
      }
      throw new AppError("Wallet cache is unavailable. Retry purchase.", 503);
    }
    debitedRedisKey = walletKey;
    debitedAmountUsd = packPriceUsd;

    await client.query(
      `
        UPDATE app_users
        SET balance = $1
        WHERE id = $2
      `,
      [debitResult.newBalanceUsd, userRow.id]
    );

    await client.query(
      `
        UPDATE pack_inventory
        SET status = 'sold'
        WHERE id = $1::uuid
      `,
      [pack.inventory_id]
    );

    const userPackResult = await client.query<{ id: string }>(
      `
        INSERT INTO user_packs (
          user_id,
          pack_id,
          drop_id,
          assignment_status,
          total_cards,
          purchase_price_usd,
          queue_message_id,
          metadata
        )
        VALUES ($1, $2, $3, 'assigned', $4, $5, $6, $7::jsonb)
        RETURNING id
      `,
      [
        payload.userId,
        pack.inventory_id,
        payload.dropId,
        pack.cards_per_pack,
        packPriceUsd,
        queueMessageId,
        JSON.stringify({ requestedAt: payload.requestedAt })
      ]
    );

    const userPackId = userPackResult.rows[0]?.id;
    if (!userPackId) {
      throw new AppError("Failed to assign purchased pack to user.", 500);
    }

    const initialSellingStatus = await resolveInitialSellingStatus(client);
    let insertedUserCards = 0;
    for (const row of catalogCardsResult.rows) {
      const acquisitionPrice =
        acquisitionPriceByCatalogCardId.get(row.id) ?? new Decimal(row.market_value_usd).toDecimalPlaces(2).toFixed(2);
      await client.query(
        `
          INSERT INTO user_cards (user_id, user_pack_id, card_id, acquisition_price, selling_status)
          VALUES ($1, $2, $3, $4::numeric, $5)
        `,
        [payload.userId, userPackId, row.id, acquisitionPrice, initialSellingStatus]
      );
      insertedUserCards += 1;
    }

    const amountGainedUsd = packPrice.minus(totalCatalogCardValueUsd).toDecimalPlaces(2).toFixed(2);
    await recordCompanyEarning(client, {
      eventType: "pack_purchase",
      transactionId: userPackId,
      amountGainedUsd,
      metadata: {
        userId: payload.userId,
        packId: pack.inventory_id,
        dropId: payload.dropId,
        tierId: payload.tierId,
        packPriceUsd: packPrice.toDecimalPlaces(2).toFixed(2),
        totalCardValueUsd: totalCatalogCardValueUsd.toDecimalPlaces(2).toFixed(2)
      }
    });

    return {
      userPackId,
      userCardCount: insertedUserCards,
      buyerWalletBalanceUsd: debitResult.newBalanceUsd,
      purchasedCards: catalogCardsResult.rows
        .map((row) => ({
          cardId: row.card_id,
          name: row.name,
          cardSet: row.card_set,
          rarity: row.rarity,
          marketValueUsd: new Decimal(row.market_value_usd).toDecimalPlaces(2).toFixed(2),
          imageUrl: row.image_url?.trim() ?? ""
        }))
        .sort((a, b) => new Decimal(a.marketValueUsd).comparedTo(new Decimal(b.marketValueUsd)))
    };
  }).catch(async (error) => {
    if (debitedRedisKey && debitedAmountUsd) {
      await creditCachedWalletBalance(debitedRedisKey, debitedAmountUsd);
    }
    throw error;
  });

  await setCachedWalletBalance(userWalletBalanceKey(payload.userId), committed.buyerWalletBalanceUsd);
  return {
    userPackId: committed.userPackId,
    userCardCount: committed.userCardCount,
    purchasedCards: committed.purchasedCards
  };
}

import { ShardedRedisPackCounter } from "../infra/redis/shardedRedisPackCounter";

async function restoreReservationWithRetry(
  packCounter: ShardedRedisPackCounter,
  payload: PackPurchaseQueuePayload,
  attempts = 3
): Promise<boolean> {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await packCounter.releaseReservation(payload.dropId, payload.tierId, payload.packId);
      return true;
    } catch (releaseError) {
      console.error("[packPurchaseQueueConsumer] failed to restore reservation", {
        attempt: i,
        attempts,
        dropId: payload.dropId,
        tierId: payload.tierId,
        packId: payload.packId,
        error: releaseError
      });
    }
  }
  return false;
}

async function main(): Promise<void> {
  const url = env.redisUrl.trim() || env.redisShardUrls[0];
  if (!url) {
    throw new Error("REDIS_URL or REDIS_SHARD_URLS is required for the consumer.");
  }

  const redis = new Redis(url);
  const packCounter = new ShardedRedisPackCounter();
  console.log("[packPurchaseQueueConsumer] started", {
    queueName: env.packPurchaseQueueName,
    redis: url
  });

  while (true) {
    try {
      const pendingBeforeWait = await redis.llen(env.packPurchaseQueueName);
      console.log("[packPurchaseQueueConsumer] waiting for message", {
        queueName: env.packPurchaseQueueName,
        pendingBeforeWait
      });
      const result = await redis.blpop(env.packPurchaseQueueName, 0);
      if (!result) continue;

      const [, message] = result;
      console.log("[packPurchaseQueueConsumer] message dequeued", {
        queueName: env.packPurchaseQueueName,
        bytes: message.length
      });
      const payload = parsePayload(message);
      console.log("[packPurchaseQueueConsumer] payload parsed", {
        userId: payload.userId,
        tierId: payload.tierId,
        dropId: payload.dropId,
        packId: payload.packId
      });

      try {
        const committed = await processPurchase(payload, null);
        await redis.publish(
          env.packTierUpdatesChannel,
          JSON.stringify({
            type: "pack_purchase_success",
            userId: payload.userId,
            dropId: payload.dropId,
            tierId: payload.tierId,
            packId: payload.packId,
            userPackId: committed.userPackId,
            userCardCount: committed.userCardCount,
            purchasedAt: new Date().toISOString(),
            cards: committed.purchasedCards
          })
        );
        console.log("[packPurchaseQueueConsumer] processed", {
          userId: payload.userId,
          tierId: payload.tierId,
          dropId: payload.dropId,
          packId: payload.packId,
          userPackId: committed.userPackId,
          userCardCount: committed.userCardCount
        });
      } catch (processError) {
        console.error("[packPurchaseQueueConsumer] transaction failed, restoring pack inventory...", processError);
        const restored = await restoreReservationWithRetry(packCounter, payload);
        if (!restored) {
          console.error(
            "[packPurchaseQueueConsumer] reservation restore exhausted retries; tier availability may be stale."
          );
        } else {
          console.log("[packPurchaseQueueConsumer] reservation restored after transaction failure", {
            userId: payload.userId,
            tierId: payload.tierId,
            dropId: payload.dropId,
            packId: payload.packId
          });
        }
      }
    } catch (error) {
      console.error("[packPurchaseQueueConsumer] error processing message", error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
