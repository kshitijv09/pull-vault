import Decimal from "decimal.js";
import Redis from "ioredis";
import { env } from "../../config/env";
import { withTransaction } from "../../db/transaction";
import { recordCompanyEarning } from "../analytics/earningsLedger.repository";
import { AUCTION_BID_PREMIUM_MULTIPLIER, AUCTION_SELLER_PREMIUM_RATE } from "../../shared/constants/premiums";
import {
  auctionHighestBidKey,
  auctionHighestBidderKey,
  clearAuctionRuntimeKeys,
  getAuctionRedis,
  getAuctionWalletBalanceFromCache,
  listAuctionParticipants,
  setCachedWalletBalance,
  userWalletBalanceKey
} from "../../infra/redis/auctionWalletStore";
import { AuctionRepository } from "./auction.repository";

const EXPIRED_EVENT_PATTERN = "__keyevent@*__:expired";
const END_KEY_REGEX = /^pullvault:auction:([0-9a-f-]{36}):end_ms$/i;

function logExpiry(auctionListingId: string, step: string, meta?: Record<string, unknown>): void {
  if (meta) {
    console.log(`[auctionExpiryProcessor][${auctionListingId}] ${step}`, meta);
    return;
  }
  console.log(`[auctionExpiryProcessor][${auctionListingId}] ${step}`);
}

export function startAuctionExpiryProcessor(): { stop: () => Promise<void> } {
  const url = env.redisUrl.trim() || env.redisShardUrls[0] || "";
  if (!url) {
    console.warn("[auctionExpiryProcessor] Redis not configured; expiry handler disabled.");
    return { stop: async () => {} };
  }

  const subscriber = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true });
  const repository = new AuctionRepository();
  const commandRedis = getAuctionRedis();
  let reconcileHandle: ReturnType<typeof setInterval> | null = null;
  let reconcileInFlight = false;

  const start = async (): Promise<void> => {
    try {
      if (commandRedis) {
        try {
          await commandRedis.config("SET", "notify-keyspace-events", "Ex");
        } catch {
          console.warn(
            "[auctionExpiryProcessor] Could not set notify-keyspace-events=Ex. Ensure Redis keyevent expiry notifications are enabled."
          );
        }
      }

      await subscriber.psubscribe(EXPIRED_EVENT_PATTERN);
      subscriber.on("pmessage", (_pattern, _channel, expiredKey) => {
        const match = END_KEY_REGEX.exec(String(expiredKey));
        if (!match) {
          return;
        }
        logExpiry(match[1], "received redis expiry event", { expiredKey: String(expiredKey) });
        void finalizeAuction(match[1], repository);
      });
      console.log("[auctionExpiryProcessor] subscribed to Redis key expiry events.");

      // Fallback path: if Redis keyevent notifications are missed/disabled, finalize overdue live listings.
      reconcileHandle = setInterval(() => {
        if (reconcileInFlight) {
          return;
        }
        reconcileInFlight = true;
        void (async () => {
          try {
            const overdueListingIds = await repository.listLiveListingsPastEndTime(100);
            if (overdueListingIds.length > 0) {
              console.warn("[auctionExpiryProcessor] reconciling overdue live listings", {
                count: overdueListingIds.length
              });
            }
            for (const listingId of overdueListingIds) {
              await finalizeAuction(listingId, repository);
            }
          } catch (error) {
            console.error("[auctionExpiryProcessor] reconcile tick failed", error);
          } finally {
            reconcileInFlight = false;
          }
        })();
      }, 5000);
    } catch (error) {
      console.error("[auctionExpiryProcessor] failed to start.", error);
    }
  };

  void start();

  return {
    stop: async () => {
      try {
        if (reconcileHandle) {
          clearInterval(reconcileHandle);
          reconcileHandle = null;
        }
        await subscriber.quit();
      } catch {
        // no-op on shutdown
      }
    }
  };
}

async function finalizeAuction(auctionListingId: string, repository: AuctionRepository): Promise<void> {
  const startedAt = Date.now();
  const redis = getAuctionRedis();
  if (!redis) {
    logExpiry(auctionListingId, "skipping finalize because redis is unavailable");
    return;
  }

  const lockKey = `pullvault:auction:${auctionListingId}:expiry_lock`;
  const lockAcquired = await redis.set(lockKey, "1", "EX", 60, "NX");
  if (!lockAcquired) {
    logExpiry(auctionListingId, "skipping finalize because expiry lock is already held");
    return;
  }
  logExpiry(auctionListingId, "expiry lock acquired", { lockKey });

  try {
    logExpiry(auctionListingId, "loading cached highest bid + participants");
    const [cachedHighBidUsd, cachedHighBidderId] = await redis.mget(
      auctionHighestBidKey(auctionListingId),
      auctionHighestBidderKey(auctionListingId)
    );
    const participantIds = await listAuctionParticipants(auctionListingId);
    logExpiry(auctionListingId, "loaded participant ids", { participantCount: participantIds.length });
    const walletByUserId = new Map<string, string>();
    for (const userId of participantIds) {
      const cached = await getAuctionWalletBalanceFromCache(auctionListingId, userId);
      if (cached) {
        walletByUserId.set(userId, cached);
      }
    }
    logExpiry(auctionListingId, "loaded cached participant wallets", { walletCount: walletByUserId.size });

    let finalizedStatus: "sold" | "unsold" | null = null;
    let winnerUserId: string | null = null;
    let winningBidUsd: string | null = null;
    let sellerUserId: string | null = null;
    let companyEarningUsd = "0.00";

    await withTransaction(async (client) => {
      logExpiry(auctionListingId, "db transaction started");
      const listing = await repository.lockListingForExpiry(client, auctionListingId);
      if (!listing) {
        logExpiry(auctionListingId, "listing not found during expiry transaction");
        return;
      }
      if (listing.status === "sold" || listing.status === "unsold") {
        finalizedStatus = listing.status;
        logExpiry(auctionListingId, "listing already finalized, skipping write path", {
          existingStatus: listing.status
        });
        return;
      }

      const highBidUsd = cachedHighBidUsd ?? listing.highestBidUsd;
      const highBidderId = cachedHighBidderId ?? listing.highestBidderId;
      sellerUserId = listing.sellerId;
      const reserveMet =
        highBidUsd != null &&
        (listing.reservePriceUsd == null || new Decimal(highBidUsd).greaterThanOrEqualTo(listing.reservePriceUsd));
      const hasWinner = Boolean(highBidUsd && highBidderId && reserveMet);
      logExpiry(auctionListingId, "computed winner eligibility", {
        hasWinner,
        reserveMet,
        hasCachedHighBid: Boolean(highBidUsd),
        hasCachedHighBidder: Boolean(highBidderId)
      });

      if (hasWinner) {
        winnerUserId = highBidderId!;
        winningBidUsd = new Decimal(highBidUsd!).toDecimalPlaces(2).toFixed(2);
        logExpiry(auctionListingId, "attempting sold finalization", {
          winnerUserId,
          winningBidUsd
        });
        const sellerCard = await repository.lockAuctionedUserCardForTransfer(
          client,
          listing.sellerId,
          listing.cardId
        );
        if (sellerCard) {
          await repository.transferUserCardToWinner(client, {
            userCardId: sellerCard.userCardId,
            winnerUserId: winnerUserId,
            winningBidUsd
          });
          logExpiry(auctionListingId, "card transferred to winner", { userCardId: sellerCard.userCardId });
        } else {
          // Fall back to unsold if inventory row cannot be located.
          winnerUserId = null;
          winningBidUsd = null;
          logExpiry(auctionListingId, "seller card row missing; fallback to unsold");
        }
      } else {
        await repository.clearSellerAuctionStatusForCard(client, listing.sellerId, listing.cardId);
        logExpiry(auctionListingId, "no winner; seller card auction status cleared");
      }

      const finalStatus: "sold" | "unsold" = winnerUserId && winningBidUsd ? "sold" : "unsold";
      finalizedStatus = finalStatus;
      logExpiry(auctionListingId, "writing listing completion state", {
        finalStatus,
        winnerUserId,
        winningBidUsd
      });
      await repository.updateListingCompletion(client, {
        auctionListingId,
        status: finalStatus,
        highestBidUsd: winnerUserId ? winningBidUsd : null,
        highestBidderId: winnerUserId,
        endTimeIso: new Date().toISOString()
      });
      await repository.completeSlotIfNoLiveListings(client, listing.slotId);
      logExpiry(auctionListingId, "slot completion check done", { slotId: listing.slotId });

      if (finalStatus === "sold" && sellerUserId && winningBidUsd) {
        // Buyer pays the winning bid only (no buyer premium).
        // Seller is charged 10% of the winning bid; seller receives the net amount.
        const sellerFeeUsd = new Decimal(winningBidUsd)
          .mul(AUCTION_SELLER_PREMIUM_RATE)
          .toDecimalPlaces(2)
          .toFixed(2);
        const sellerNetUsd = new Decimal(winningBidUsd)
          .minus(sellerFeeUsd)
          .toDecimalPlaces(2)
          .toFixed(2);
        companyEarningUsd = sellerFeeUsd;

        void AUCTION_BID_PREMIUM_MULTIPLIER; // retained import; buyer multiplier is 1.0 (no-op)

        await repository.creditUserBalance(client, sellerUserId, sellerNetUsd);
        logExpiry(auctionListingId, "seller credited winning bid minus 10% platform fee", {
          sellerUserId,
          winningBidUsd,
          sellerFeeUsd,
          sellerNetUsd
        });
      }
      for (const [userId, wallet] of walletByUserId.entries()) {
        await repository.setUserBalance(client, userId, wallet);
      }
      logExpiry(auctionListingId, "persisted participant wallet balances", {
        persistedWalletCount: walletByUserId.size
      });

      await recordCompanyEarning(client, {
        eventType: "auction_completion",
        transactionId: auctionListingId,
        amountGainedUsd: companyEarningUsd,
        metadata: {
          status: finalStatus,
          winnerUserId,
          sellerUserId,
          winningBidUsd
        }
      });
      logExpiry(auctionListingId, "company earnings ledger recorded", {
        companyEarningUsd
      });
    });
    logExpiry(auctionListingId, "db transaction completed");

    for (const [userId, wallet] of walletByUserId.entries()) {
      await setCachedWalletBalance(userWalletBalanceKey(userId), wallet);
    }
    if (sellerUserId && finalizedStatus === "sold") {
      const sellerDbBalance = await repository.getUserBalance(sellerUserId);
      if (sellerDbBalance != null) {
        await setCachedWalletBalance(userWalletBalanceKey(sellerUserId), sellerDbBalance);
      }
    }
    logExpiry(auctionListingId, "synced wallet cache after transaction", {
      participantWalletsSynced: walletByUserId.size,
      sellerSynced: Boolean(sellerUserId && finalizedStatus === "sold")
    });

    if (finalizedStatus) {
      const finalizedDetails = await repository.getAuctionFinalizedDetails(auctionListingId, winnerUserId);
      logExpiry(auctionListingId, "publishing auction_finalized socket event", {
        finalizedStatus,
        winnerUserId,
        winningBidUsd,
        cardName: finalizedDetails?.cardName ?? null,
        winnerName: finalizedDetails?.winnerName ?? null
      });
      await redis.publish(
        env.auctionBidBroadcastChannel,
        JSON.stringify({
          type: "auction_finalized",
          auctionListingId,
          status: finalizedStatus,
          winnerUserId,
          winningBidUsd,
          cardName: finalizedDetails?.cardName ?? null,
          winnerName: finalizedDetails?.winnerName ?? null,
          updatedAt: new Date().toISOString()
        })
      );
      if (winnerUserId && sellerUserId) {
        console.log(
          `[auctionExpiryProcessor] TODO email notifications seller=${sellerUserId} winner=${winnerUserId} auction=${auctionListingId}`
        );
      }
    }
  } catch (error) {
    console.error(`[auctionExpiryProcessor] failed for auction ${auctionListingId}`, error);
  } finally {
    logExpiry(auctionListingId, "clearing runtime redis keys");
    await clearAuctionRuntimeKeys(auctionListingId);
    logExpiry(auctionListingId, "releasing expiry lock");
    await redis.del(lockKey);
    logExpiry(auctionListingId, "finalize flow complete", { elapsedMs: Date.now() - startedAt });
  }
}
