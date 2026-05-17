import { AppError } from "../../shared/errors/AppError";
import { ShardedRedisPackCounter } from "../../infra/redis/shardedRedisPackCounter";
import { RedisPackPurchasePublisher } from "../../infra/mq/redisPackPurchasePublisher";
import { UserRepository } from "../user/user.repository";
import { query } from "../../db";
import { getOrderedPackIdsForTier } from "./packInventoryCapStore";
import { getOrPrimeWalletBalance, userWalletBalanceKey } from "../../infra/redis/auctionWalletStore";
import {
  PACK_FAIRNESS_MODE,
  type PackFairnessMode
} from "../../shared/constants/packFairnessCommit.constants";
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

    const tierContext = await this.getTierContext(parsed.dropId, parsed.tierId);
    if (tierContext.fairnessMode === PACK_FAIRNESS_MODE.FAIRNESS && !parsed.nonce) {
      throw new AppError(
        "Fairness session nonce is required for this drop. Call /drops/:dropId/fairness-commit first.",
        400
      );
    }
    if (parsed.nonce) {
      await this.assertFairnessCommitUsable(parsed.nonce, parsed.dropId, userId);
    }
    const tierPriceUsd = tierContext.priceUsd;
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
    const rawNonce = record.nonce;
    let nonce: string | undefined;
    if (typeof rawNonce === "string" && rawNonce.trim().length > 0) {
      nonce = rawNonce.trim();
    } else if (rawNonce !== undefined && rawNonce !== null && rawNonce !== "") {
      throw new AppError("nonce must be a non-empty string when provided.", 400);
    }

    return {
      dropId: assertNonEmpty("dropId", record.dropId),
      tierId: assertNonEmpty("tierId", record.tierId),
      ...(nonce ? { nonce } : {})
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

  private async getTierContext(
    dropId: string,
    tierId: string
  ): Promise<{ priceUsd: string; fairnessMode: PackFairnessMode }> {
    const result = await query<{ price_usd: string; fairness_mode: string }>(
      `
        SELECT
          p.price::text AS price_usd,
          COALESCE(d.fairness_mode, 'legacy') AS fairness_mode
        FROM pack_inventory pi
        INNER JOIN packs p ON p.id = pi.pack_id
        LEFT JOIN drops d ON d.id = pi.drop_id
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
    const mode =
      row.fairness_mode === PACK_FAIRNESS_MODE.FAIRNESS
        ? PACK_FAIRNESS_MODE.FAIRNESS
        : PACK_FAIRNESS_MODE.LEGACY;
    return { priceUsd: row.price_usd, fairnessMode: mode };
  }

  private async assertFairnessCommitUsable(nonce: string, dropId: string, userId: string): Promise<void> {
    const result = await query<{ id: string; consumed_at: string | null }>(
      `
        SELECT id, consumed_at
        FROM pack_fairness_commit
        WHERE id = $1::uuid
          AND user_id = $2::uuid
          AND drop_id = $3::uuid
        LIMIT 1
      `,
      [nonce, userId, dropId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(
        "Fairness session not found for this drop. Call /drops/:dropId/fairness-commit first.",
        404
      );
    }
    if (row.consumed_at) {
      throw new AppError("Fairness session has already been consumed by a previous purchase.", 409);
    }
  }
}
