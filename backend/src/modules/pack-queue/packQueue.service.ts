import { AppError } from "../../shared/errors/AppError";
import { ShardedRedisPackCounter } from "../../infra/redis/shardedRedisPackCounter";
import { RedisPackPurchasePublisher } from "../../infra/mq/redisPackPurchasePublisher";
import { UserRepository } from "../user/user.repository";
import { query } from "../../db";
import { getOrderedPackIdsForTier } from "./packInventoryCapStore";
import { getOrPrimeWalletBalance, userWalletBalanceKey } from "../../infra/redis/auctionWalletStore";
import type { PackPurchaseQueuePayload, QueuePackPurchaseAccepted, QueuePackPurchaseBody } from "./packQueue.types";

function assertNonEmpty(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(`${field} is required.`, 400);
  }
  return value.trim();
}

/**
 * Fast-fail validation + Redis tier available-list Lua + Redis list enqueue.
 */
export class PackQueueService {
  private readonly userRepository: UserRepository;

  constructor(
    private readonly packCounter: ShardedRedisPackCounter,
    private readonly publisher: RedisPackPurchasePublisher
  ) {
    this.userRepository = new UserRepository();
  }

  async enqueuePackPurchase(body: unknown, userIdFromHeader: string): Promise<QueuePackPurchaseAccepted> {
    const parsed = this.parseBody(body);
    const userId = assertNonEmpty("x-user-id header", userIdFromHeader);
    console.log("[packQueueService] purchase request received", {
      userId,
      dropId: parsed.dropId,
      tierId: parsed.tierId
    });

    if (!this.packCounter.isConfigured()) {
      throw new AppError("Redis shard URLs are not configured.", 503);
    }

    let orderedPackIds = getOrderedPackIdsForTier(parsed.dropId, parsed.tierId);
    if (orderedPackIds.length === 0) {
      // Fallback: fetch ordered ids from Redis tier available list.
      orderedPackIds = await this.packCounter.getOrderedPackIdsForTier(parsed.dropId, parsed.tierId);
      if (orderedPackIds.length === 0) {
        throw new AppError("Unknown tier for this drop or no packs in inventory.", 404);
      }
      console.log("[packQueueService] in-memory tier missing; fallback loaded from Redis", {
        dropId: parsed.dropId,
        tierId: parsed.tierId,
        packCount: orderedPackIds.length
      });
    }

    const tierPriceUsd = await this.getTierPriceUsd(parsed.dropId, parsed.tierId);
    const cachedWalletBalanceUsd = await this.ensureSharedWalletCached(userId);

    const reserve = await this.packCounter.tryReserveFromTierAvailableList(
      parsed.dropId,
      parsed.tierId,
      tierPriceUsd,
      cachedWalletBalanceUsd
    );
    if (!reserve.ok) {
      if (reserve.reason === "sold_out") {
        throw new AppError("Pack line is sold out for this tier.", 409);
      }
      if (reserve.reason === "wallet_missing") {
        throw new AppError("Wallet cache is not initialized for this drop session.", 409);
      }
      if (reserve.reason === "insufficient_balance") {
        throw new AppError("Insufficient wallet balance for selected tier.", 409);
      }
      throw new AppError("Pack counter is not available.", 503);
    }
    console.log("[packQueueService] reserved pack for queue", {
      userId,
      dropId: parsed.dropId,
      tierId: parsed.tierId,
      packId: reserve.packId
    });

    const payload: PackPurchaseQueuePayload = {
      ...parsed,
      userId,
      packId: reserve.packId,
      requestedAt: new Date().toISOString()
    };

    try {
      await this.publisher.enqueue(payload);
      console.log("[packQueueService] enqueue succeeded", {
        userId,
        dropId: parsed.dropId,
        tierId: parsed.tierId,
        packId: reserve.packId
      });
    } catch (error) {
      console.error("[packQueueService] enqueue failed, releasing reservation", {
        userId,
        dropId: parsed.dropId,
        tierId: parsed.tierId,
        packId: reserve.packId,
        error
      });
      await this.packCounter.releaseReservation(
        parsed.dropId,
        parsed.tierId,
        reserve.packId
      );
      throw error;
    }

    return {
      status: "queued",
      message: "You have been queued."
    };
  }

  private parseBody(body: unknown): QueuePackPurchaseBody {
    if (body === null || typeof body !== "object") {
      throw new AppError("Request body must be a JSON object.", 400);
    }

    const record = body as Record<string, unknown>;
    return {
      dropId: assertNonEmpty("dropId", record.dropId),
      tierId: assertNonEmpty("tierId", record.tierId)
    };
  }

  private async ensureSharedWalletCached(userId: string): Promise<string> {
    console.log("[packQueueService] loading wallet from DB for purchase precheck", {
      userId
    });
    const user = await this.userRepository.getById(userId);
    const key = userWalletBalanceKey(userId);
    const wallet = await getOrPrimeWalletBalance(key, user.balance);
    console.log("[packQueueService] wallet cache resolved for purchase precheck", {
      userId,
      walletKey: key,
      walletSource: wallet?.source ?? "unavailable",
      cachedBalanceUsd: wallet?.balanceUsd ?? null
    });
    if (!wallet || !wallet.balanceUsd) {
      throw new AppError("Wallet cache is unavailable. Retry purchase.", 503);
    }
    return wallet.balanceUsd;
  }

  private async getTierPriceUsd(dropId: string, tierId: string): Promise<string> {
    const result = await query<{ price_usd: string }>(
      `
        SELECT p.price::text AS price_usd
        FROM pack_inventory pi
        INNER JOIN packs p ON p.id = pi.pack_id
        WHERE pi.drop_id = $1::uuid
          AND lower(p.tier_name) = lower($2)
        LIMIT 1
      `,
      [dropId, tierId]
    );
    const row = result.rows[0];
    if (!row?.price_usd) {
      throw new AppError("Unknown tier for this drop or no packs in inventory.", 404);
    }
    return row.price_usd;
  }
}
