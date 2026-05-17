import Decimal from "decimal.js";
import { fetchJustTcgCardPriceUsdByCardId } from "../../infra/tcgpricelookup/tcgPriceLookupClient";
import {
  auctionListingJustTcgRefUsdKey,
  auctionWalletKey,
  cacheAuctionEndTimeWithTtl,
  creditCachedWalletBalance,
  getAuctionListingJustTcgRefUsd,
  getAuctionWalletBalanceFromCache,
  getCachedHighestBidState,
  getAuctionCountdownState,
  getAuctionRedis,
  getOrPrimeWalletBalance,
  getUserSealedBidAmountFromRedis,
  isSealedPhaseActiveInRedis,
  markAuctionParticipant,
  placeAuctionBidInRedis,
  placeSealedAuctionBidInRedis,
  publishAuctionBidUpdated,
  publishAuctionSealedPhaseStarted,
  userWalletBalanceKey
} from "../../infra/redis/auctionWalletStore";
import { withTransaction } from "../../db/transaction";
import { AppError } from "../../shared/errors/AppError";
import {
  AUCTION_FRAUD_BID_SPAM_COUNT_THRESHOLD,
  AUCTION_FRAUD_BID_SPAM_WINDOW_SECONDS,
  AUCTION_FRAUD_H3_MIN_OPEN_BIDS_NON_WINNER,
  AUCTION_FRAUD_REPEAT_PAIR_MIN_CLOSED_TRADES,
  AUCTION_FRAUD_REPEAT_PAIR_WINDOW_DAYS,
  AUCTION_FRAUD_UNCONTESTED_LOW_PRICE_RATIO_MAX
} from "../../shared/constants/auctionFraudReview.constants";
import {
  AUCTION_BID_PREMIUM_MULTIPLIER,
  AUCTION_MAX_BID_VS_JUSTTCG_REFERENCE_MULTIPLIER
} from "../../shared/constants/premiums";
import { AuctionRepository } from "./auction.repository";
import { encryptSealedBidAmountPlaintext } from "../../shared/crypto/sealedBidCrypto";
import type {
  AuctionBidBroadcastPayload,
  AuctionBidInitResult,
  AuctionFraudReviewResult,
  AuctionListingsFilter,
  AuctionListingRow,
  AuctionListingStatus,
  GoLiveAuctionResult,
  PlaceAuctionBidResult,
  PlaceSealedAuctionBidResult,
  StartAuctionResult
} from "./auction.types";

const DEFAULT_SLOT_CAPACITY = 100;
const DEFAULT_AUCTION_DURATION_MINUTES = 10;
const ANTI_SNIPING_TRIGGER_WINDOW_MS = 30 * 1000;
const ANTI_SNIPING_EXTENSION_MS = 30 * 1000;

type BidIncrementRuleRow = { minPrice: string; maxPrice: string | null; minIncrement: string };

/** Matches `getMinIncrementForCurrentPrice` band selection (highest `min_price` that contains `standingBidUsd`). */
function minIncrementForStandingBid(rules: BidIncrementRuleRow[], standingBidUsd: string): string | null {
  const p = new Decimal(standingBidUsd);
  let chosen: string | null = null;
  let chosenMinPrice: Decimal | null = null;
  for (const r of rules) {
    const minP = new Decimal(r.minPrice);
    const maxP = r.maxPrice == null ? null : new Decimal(r.maxPrice);
    if (p.greaterThanOrEqualTo(minP) && (maxP === null || p.lessThanOrEqualTo(maxP))) {
      if (chosenMinPrice === null || minP.greaterThan(chosenMinPrice)) {
        chosenMinPrice = minP;
        chosen = r.minIncrement;
      }
    }
  }
  return chosen;
}

export class AuctionService {
  constructor(private readonly repository: AuctionRepository) {}

  async getSlots(slotStatusRaw?: string) {
    const filter = slotStatusRaw ? { slotStatus: slotStatusRaw as any } : undefined;
    return this.repository.listSlots(filter);
  }

  async getAuctions(filter?: AuctionListingsFilter): Promise<AuctionListingRow[]> {
    return this.repository.listAuctions(filter);
  }

  /**
   * H1 OR H2 OR H3 OR H6 → persist `needs_fraud_review` (true if any heuristic fires).
   * H1: ≥ min closed sold trades between same seller & winner in rolling window (needs current high bidder).
   * H2: sold, exactly one distinct open-phase bidder, winning bid / catalog market &lt; threshold.
   * H3: sold — some non-winner (not seller) has ≥ min open bids on this listing (heavy bid-then-lose).
   * H6: same bidder &gt; threshold bids in a rolling window on `auction_bid_history`, OR consecutive open bids
   *     below prior standing bid + configured min increment.
   */
  async evaluateAuctionFraudReview(auctionListingId: string): Promise<AuctionFraudReviewResult> {
    if (!auctionListingId.trim()) {
      throw new AppError("Auction id is required.", 400);
    }
    const listing = await this.repository.getListingForFraudReview(auctionListingId.trim());
    if (!listing) {
      throw new AppError("Auction listing not found.", 404);
    }

    let pairTradeCountInWindow = 0;
    let h1RepeatPairSuspicion = false;
    const buyerId = listing.currentHighBidderId?.trim() ?? "";
    if (buyerId) {
      pairTradeCountInWindow = await this.repository.countSoldPairTradesInWindow(
        listing.sellerId,
        buyerId,
        AUCTION_FRAUD_REPEAT_PAIR_WINDOW_DAYS
      );
      h1RepeatPairSuspicion = pairTradeCountInWindow >= AUCTION_FRAUD_REPEAT_PAIR_MIN_CLOSED_TRADES;
    }

    let h2UncontestedLowPriceSuspicion = false;
    let distinctOpenBidders: number | null = null;
    let priceToMarketRatio: string | null = null;

    if (listing.status === "sold" && listing.currentHighBidUsd != null && listing.currentHighBidUsd !== "") {
      distinctOpenBidders = await this.repository.countDistinctOpenBiddersForListing(listing.id);
      const market = new Decimal(listing.marketValueUsd);
      const high = new Decimal(listing.currentHighBidUsd);
      if (market.greaterThan(0) && distinctOpenBidders === 1) {
        const ratio = high.div(market);
        priceToMarketRatio = ratio.toDecimalPlaces(6).toFixed(6);
        h2UncontestedLowPriceSuspicion = ratio.lessThan(AUCTION_FRAUD_UNCONTESTED_LOW_PRICE_RATIO_MAX);
      }
    }

    const h3MaxNonWinnerOpenBidCount =
      await this.repository.getMaxOpenBidCountAmongSoldListingNonWinners(listing.id);
    const h3HeavyNonWinnerOpenBidsSuspicion =
      h3MaxNonWinnerOpenBidCount >= AUCTION_FRAUD_H3_MIN_OPEN_BIDS_NON_WINNER;

    const h6MaxBidsInRollingWindow = await this.repository.getMaxOpenBidsPerBidderInRollingWindow(
      listing.id,
      AUCTION_FRAUD_BID_SPAM_WINDOW_SECONDS
    );
    const h6RapidBurst =
      h6MaxBidsInRollingWindow > AUCTION_FRAUD_BID_SPAM_COUNT_THRESHOLD;

    const incrementRules = await this.repository.listBidIncrementRules();
    const bidAmountsAsc = await this.repository.listOpenBidHistoryAmountsAsc(listing.id);
    let h6IncrementViolationCount = 0;
    for (let i = 1; i < bidAmountsAsc.length; i++) {
      const prev = bidAmountsAsc[i - 1].bidAmountUsd;
      const curr = bidAmountsAsc[i].bidAmountUsd;
      const inc = minIncrementForStandingBid(incrementRules, prev);
      if (inc == null) {
        continue;
      }
      const minNext = new Decimal(prev).plus(new Decimal(inc));
      if (new Decimal(curr).lessThan(minNext)) {
        h6IncrementViolationCount += 1;
      }
    }
    const h6SingleAccountBidSpamSuspicion =
      h6RapidBurst || h6IncrementViolationCount > 0;

    const needsFraudReview =
      h1RepeatPairSuspicion ||
      h2UncontestedLowPriceSuspicion ||
      h3HeavyNonWinnerOpenBidsSuspicion ||
      h6SingleAccountBidSpamSuspicion;
    await this.repository.setAuctionListingNeedsFraudReview(listing.id, needsFraudReview);

    return {
      auctionListingId: listing.id,
      needsFraudReview,
      h1RepeatPairSuspicion,
      h2UncontestedLowPriceSuspicion,
      h3HeavyNonWinnerOpenBidsSuspicion,
      h6SingleAccountBidSpamSuspicion,
      heuristics: {
        pairTradeCountInWindow,
        repeatPairWindowDays: AUCTION_FRAUD_REPEAT_PAIR_WINDOW_DAYS,
        distinctOpenBidders,
        priceToMarketRatio,
        h3MaxNonWinnerOpenBidCount,
        h3MinOpenBidsNonWinnerThreshold: AUCTION_FRAUD_H3_MIN_OPEN_BIDS_NON_WINNER,
        h6MaxBidsInRollingWindow,
        h6BidSpamWindowSeconds: AUCTION_FRAUD_BID_SPAM_WINDOW_SECONDS,
        h6IncrementViolationCount
      }
    };
  }

  async goLiveForAuction(
    ownerUserId: string,
    userCardId: string,
    startBidUsdRaw?: string,
    reservePriceUsdRaw?: string
  ): Promise<GoLiveAuctionResult> {
    if (!ownerUserId.trim() || !userCardId.trim()) {
      throw new AppError("User id and card id are required.", 400);
    }

    const result = await withTransaction(async (client) => {
      const cardRow = await this.repository.lockUserCardForOwner(client, userCardId, ownerUserId);
      if (!cardRow) {
        throw new AppError("Card not found in your collection.", 404);
      }
      if (cardRow.sellingStatus === "listed_for_sale") {
        throw new AppError("Unlist this card from the marketplace before putting it up for auction.", 400);
      }
      if (cardRow.sellingStatus === "listed_for_auction") {
        throw new AppError("This card is already live for auction.", 400);
      }

      const startBidUsd = this.parseStartBid(startBidUsdRaw, cardRow.marketValueUsd);
      const reservePriceUsd = this.parseReservePrice(reservePriceUsdRaw, startBidUsd);

      let slot = await this.repository.findSlotWithRemainingCapacity(client);
      if (!slot) {
        slot = await this.repository.createDefaultActiveSlot(
          client,
          DEFAULT_SLOT_CAPACITY,
          DEFAULT_AUCTION_DURATION_MINUTES
        );
      }

      const listingStatus: AuctionListingStatus =
        slot.status === "active" && slot.start_time.getTime() <= Date.now() ? "live" : "pending";
      const listingBaseTime =
        listingStatus === "live" ? new Date() : new Date(Math.max(slot.start_time.getTime(), Date.now()));
      const slotDurationMs = this.slotDurationMinutesToMs(slot.duration);
      const endTime = new Date(listingBaseTime.getTime() + slotDurationMs);
      const endTimeIso = endTime.toISOString();

      let created: { id: string };
      try {
        created = await this.repository.createAuctionListing(client, {
          slotId: slot.id,
          userCardId: cardRow.userCardId,
          sellerId: ownerUserId,
          startBidUsd,
          reservePriceUsd,
          endTimeIso,
          status: listingStatus
        });
      } catch (error) {
        const dbError = error as { code?: string } | undefined;
        if (dbError?.code === "23505") {
          throw new AppError("This card is already listed in an active auction.", 400);
        }
        throw error;
      }

      await this.repository.setUserCardSellingStatus(client, userCardId, "listed_for_auction");
      await this.repository.incrementSlotCurrentCapacity(client, slot.id);

      return {
        auctionListingId: created.id,
        userCardId,
        sellingStatus: "listed_for_auction" as const,
        slotId: slot.id,
        listingStatus,
        endTimeIso
      };
    });

    if (result.listingStatus === "live") {
      await cacheAuctionEndTimeWithTtl(result.auctionListingId, result.endTimeIso);
    }
    return result;
  }

  /** Add the caller's card to a specific upcoming slot (`auction_listings` row). */
  async addUserListingToSlot(
    slotId: string,
    ownerUserId: string,
    userCardId: string,
    startBidUsdRaw: string,
    reservePriceUsdRaw?: string
  ): Promise<GoLiveAuctionResult> {
    if (!slotId.trim() || !ownerUserId.trim() || !userCardId.trim()) {
      throw new AppError("Slot id, user id and card id are required.", 400);
    }
    const startBidInput = typeof startBidUsdRaw === "string" ? startBidUsdRaw.trim() : "";
    if (!startBidInput) {
      throw new AppError("Body startBidUsd is required.", 400);
    }

    const result = await withTransaction(async (client) => {
      const slotRow = await this.repository.lockSlotByIdForListingInsert(client, slotId);
      if (!slotRow) {
        throw new AppError("Auction slot not found.", 404);
      }
      if (slotRow.status === "completed" || slotRow.status === "cancelled") {
        throw new AppError("This auction slot is closed.", 400);
      }
      const now = Date.now();
      const slotStarted = slotRow.start_time.getTime() <= now;
      const isUpcoming =
        slotRow.status === "scheduled" || (slotRow.status === "active" && !slotStarted);
      if (!isUpcoming) {
        throw new AppError("Cards can only be added to upcoming auctions.", 400);
      }
      if (slotRow.current_capacity >= slotRow.capacity) {
        throw new AppError("This auction slot is full.", 400);
      }

      const cardRow = await this.repository.lockUserCardForOwner(client, userCardId, ownerUserId);
      if (!cardRow) {
        throw new AppError("Card not found in your collection.", 404);
      }
      if (cardRow.sellingStatus === "listed_for_sale") {
        throw new AppError("Unlist this card from the marketplace before putting it up for auction.", 400);
      }
      if (cardRow.sellingStatus === "listed_for_auction") {
        throw new AppError("This card is already in an auction.", 400);
      }

      const startBidUsd = this.parseStartBid(startBidInput, cardRow.marketValueUsd);
      const reservePriceUsd = this.parseReservePrice(reservePriceUsdRaw, startBidUsd);

      const listingStatus: AuctionListingStatus =
        slotRow.status === "active" && slotStarted ? "live" : "pending";
      const listingBaseTime =
        listingStatus === "live" ? new Date() : new Date(Math.max(slotRow.start_time.getTime(), Date.now()));
      const slotDurationMs = this.slotDurationMinutesToMs(slotRow.duration);
      const endTime = new Date(listingBaseTime.getTime() + slotDurationMs);
      const endTimeIso = endTime.toISOString();

      let created: { id: string };
      try {
        created = await this.repository.createAuctionListing(client, {
          slotId: slotRow.id,
          userCardId: cardRow.userCardId,
          sellerId: ownerUserId,
          startBidUsd,
          reservePriceUsd,
          endTimeIso,
          status: listingStatus
        });
      } catch (error) {
        const dbError = error as { code?: string } | undefined;
        if (dbError?.code === "23505") {
          throw new AppError("This card is already listed in an active auction.", 400);
        }
        throw error;
      }

      await this.repository.setUserCardSellingStatus(client, userCardId, "listed_for_auction");
      await this.repository.incrementSlotCurrentCapacity(client, slotRow.id);

      return {
        auctionListingId: created.id,
        userCardId,
        sellingStatus: "listed_for_auction" as const,
        slotId: slotRow.id,
        listingStatus,
        endTimeIso
      };
    });

    if (result.listingStatus === "live") {
      await cacheAuctionEndTimeWithTtl(result.auctionListingId, result.endTimeIso);
    }
    return result;
  }

  async createSlot(startTimeRaw: string | undefined, capacityRaw: number | undefined, durationRaw: number | undefined, nameRaw?: string) {
    if (!startTimeRaw) {
      throw new AppError("start_time is required.", 400);
    }
    const startTimeStamp = Date.parse(startTimeRaw);
    if (!Number.isFinite(startTimeStamp)) {
      throw new AppError("start_time is invalid.", 400);
    }
    if (startTimeStamp <= Date.now()) {
      throw new AppError("start_time must be in the future.", 400);
    }

    const capacity = Number.isFinite(capacityRaw) && capacityRaw! > 0 ? capacityRaw! : DEFAULT_SLOT_CAPACITY;
    const duration = Number.isFinite(durationRaw) && durationRaw! > 0 ? durationRaw! : DEFAULT_AUCTION_DURATION_MINUTES;
    const name = nameRaw?.trim() ? nameRaw.trim() : undefined;

    return withTransaction(async (client) => {
      const slot = await this.repository.insertSlot(client, new Date(startTimeStamp).toISOString(), capacity, duration, name);
      return {
        id: slot.id,
        status: slot.status,
        startTime: slot.start_time.toISOString(),
        capacity: slot.capacity,
        currentCapacity: slot.current_capacity,
        duration: slot.duration,
        name: slot.name
      };
    });
  }
  async startAuction(auctionSlotId: string, requesterUserId: string): Promise<StartAuctionResult> {
    const redis = getAuctionRedis();
    if (!redis) {
      throw new AppError("Redis is not configured.", 503);
    }
    if (!auctionSlotId.trim() || !requesterUserId.trim()) {
      throw new AppError("Auction slot id and user id are required.", 400);
    }

    const started = await withTransaction(async (client) => {
      const slot = await this.repository.lockAuctionSlotForStart(client, auctionSlotId);
      if (!slot) {
        throw new AppError("Auction slot not found.", 404);
      }
      if (slot.status === "completed" || slot.status === "cancelled") {
        throw new AppError("Auction slot is already closed.", 400);
      }
      const slotStartMs = Date.parse(slot.startTime);
      if (!Number.isFinite(slotStartMs)) {
        throw new AppError("Auction slot start time is invalid.", 500);
      }
      const slotDurationMs = this.slotDurationMinutesToMs(slot.duration);
      const slotEndMs = slotStartMs + slotDurationMs;
      if (slotEndMs <= Date.now()) {
        throw new AppError("Auction slot end time has already passed.", 400);
      }
      const slotEndIso = new Date(slotEndMs).toISOString();

      const startedListingIds = await this.repository.activateSlotAndLiveListingsForStart(
        client,
        slot.id,
        slotEndIso
      );
      if (startedListingIds.length === 0) {
        throw new AppError("No startable listings found for this auction slot.", 400);
      }

      return {
        auctionSlotId: slot.id,
        endTime: slotEndIso,
        startedListingIds,
        status: "live" as const
      };
    });

    await Promise.all(
      started.startedListingIds.map(async (id) => {
        await cacheAuctionEndTimeWithTtl(id, started.endTime);
      })
    );
    const slotEndMs = Date.parse(started.endTime);
    if (Number.isFinite(slotEndMs)) {
      await this.prefetchJustTcgReferencePricesForListings(started.startedListingIds, slotEndMs);
    }
    return started;
  }

  async initBidSession(auctionListingId: string, bidderUserId: string): Promise<AuctionBidInitResult> {
    if (!auctionListingId.trim() || !bidderUserId.trim()) {
      throw new AppError("Auction id and bidder id are required.", 400);
    }

    const listing = await this.repository.getAuctionListingById(auctionListingId);
    if (!listing) {
      throw new AppError("Auction listing not found.", 404);
    }
    if (listing.status !== "live") {
      throw new AppError("Auction is not live yet.", 400);
    }

    const countdown = await getAuctionCountdownState(auctionListingId);
    if (!countdown.ok) {
      if (countdown.reason === "not_configured") {
        throw new AppError("Redis is not configured.", 503);
      }
      if (countdown.reason === "not_started") {
        throw new AppError("Auction timer has not been started.", 400);
      }
      throw new AppError("Auction has already ended.", 400);
    }

    const userBalance = await this.repository.getUserBalance(bidderUserId);
    if (userBalance == null) {
      throw new AppError("User not found.", 404);
    }
    const walletState = await getOrPrimeWalletBalance(
      auctionWalletKey(auctionListingId, bidderUserId),
      userBalance,
      Math.max(1, Math.ceil(countdown.ttlMs / 1000))
    );
    if (!walletState) {
      throw new AppError("Redis is not configured.", 503);
    }
    if (walletState.source === "db") {
      await markAuctionParticipant(
        auctionListingId,
        bidderUserId,
        Math.max(1, Math.ceil(countdown.ttlMs / 1000))
      );
    }

    const cachedHighest = await getCachedHighestBidState(auctionListingId);
    const currentBidUsd = cachedHighest?.bidUsd ?? listing.startBidUsd;
    const incrementUsd =
      (await this.repository.getMinIncrementForCurrentPrice(currentBidUsd)) ??
      this.defaultIncrementFor(currentBidUsd);
    const minBidUsd = new Decimal(currentBidUsd).plus(new Decimal(incrementUsd)).toDecimalPlaces(2).toFixed(2);
    const sealedPhaseActive =
      (await isSealedPhaseActiveInRedis(auctionListingId)) || listing.sealedPhaseActive;
    const hasSubmittedSealedBid = await this.userHasSubmittedSealedBid(auctionListingId, bidderUserId);

    return {
      auctionListingId: listing.id,
      endTime: listing.endTime,
      minBidUsd,
      walletBalanceUsd: walletState.balanceUsd,
      walletSource: walletState.source,
      sealedPhaseActive,
      hasSubmittedSealedBid
    };
  }

  private async userHasSubmittedSealedBid(auctionListingId: string, bidderUserId: string): Promise<boolean> {
    const fromRedis = await getUserSealedBidAmountFromRedis(auctionListingId, bidderUserId);
    if (fromRedis != null) {
      return true;
    }
    return this.repository.hasUserSealedBidRecord(auctionListingId, bidderUserId);
  }

  async restoreOutbidWallet(auctionListingId: string, bidderUserId: string, amountUsdRaw: string): Promise<string> {
    if (!auctionListingId.trim() || !bidderUserId.trim()) {
      throw new AppError("Auction id and bidder id are required.", 400);
    }
    const amount = this.assertPositiveMoneyString(amountUsdRaw, "restore amount");

    const countdown = await getAuctionCountdownState(auctionListingId);
    if (!countdown.ok) {
      if (countdown.reason === "not_configured") {
        throw new AppError("Redis is not configured.", 503);
      }
      if (countdown.reason === "not_started") {
        throw new AppError("Auction timer has not been started.", 400);
      }
      throw new AppError("Auction has already ended.", 400);
    }

    const walletKey = auctionWalletKey(auctionListingId, bidderUserId);
    const redis = getAuctionRedis();
    const existing = redis ? await redis.get(walletKey) : null;
    if (existing == null || existing === "") {
      const dbBalance = await this.repository.getUserBalance(bidderUserId);
      if (dbBalance == null) {
        throw new AppError("User not found.", 404);
      }
      await getOrPrimeWalletBalance(
        walletKey,
        dbBalance,
        Math.max(1, Math.ceil(countdown.ttlMs / 1000))
      );
    }
    const updated = await creditCachedWalletBalance(
      walletKey,
      amount,
      Math.max(1, Math.ceil(countdown.ttlMs / 1000))
    );
    if (updated == null) {
      throw new AppError("Redis is not configured.", 503);
    }
    await markAuctionParticipant(
      auctionListingId,
      bidderUserId,
      Math.max(1, Math.ceil(countdown.ttlMs / 1000))
    );
    return updated;
  }

  async placeBid(
    auctionListingId: string,
    bidderUserId: string,
    biddingPriceUsdRaw: string
  ): Promise<PlaceAuctionBidResult> {
    if (!auctionListingId.trim() || !bidderUserId.trim()) {
      throw new AppError("Auction id and bidder id are required.", 400);
    }
    const biddingPriceUsd = this.assertPositiveMoneyString(biddingPriceUsdRaw, "bid amount");

    const listing = await this.repository.getAuctionListingById(auctionListingId);
    if (!listing) {
      throw new AppError("Auction listing not found.", 404);
    }
    if (listing.status !== "live") {
      throw new AppError("Auction is not live yet.", 400);
    }
    if (listing.sellerId === bidderUserId) {
      throw new AppError("Seller cannot bid on their own auction.", 400);
    }
    if ((await isSealedPhaseActiveInRedis(auctionListingId)) || listing.sealedPhaseActive) {
      throw new AppError(
        "This auction is in the sealed-bid phase. Use POST /auctions/:auctionId/bids/sealed with biddingPriceUsd.",
        400
      );
    }

    const countdown = await getAuctionCountdownState(auctionListingId);
    if (!countdown.ok) {
      if (countdown.reason === "not_configured") {
        throw new AppError("Redis is not configured.", 503);
      }
      if (countdown.reason === "not_started") {
        throw new AppError("Auction timer has not been started.", 400);
      }
      throw new AppError("Auction has already ended.", 400);
    }

    const bidderDbBalance = await this.repository.getUserBalance(bidderUserId);
    if (bidderDbBalance == null) {
      throw new AppError("User not found.", 404);
    }
    await getOrPrimeWalletBalance(
      userWalletBalanceKey(bidderUserId),
      bidderDbBalance,
      Math.max(1, Math.ceil(countdown.ttlMs / 1000))
    );

    await this.assertBidWithinJustTcgReferenceCap(auctionListingId, biddingPriceUsd);

    const cachedHighest = await getCachedHighestBidState(auctionListingId);
    const currentBidUsd = cachedHighest?.bidUsd ?? listing.startBidUsd;
    const incrementUsd =
      (await this.repository.getMinIncrementForCurrentPrice(currentBidUsd)) ??
      this.defaultIncrementFor(currentBidUsd);
    const minAccepted = new Decimal(currentBidUsd).plus(new Decimal(incrementUsd)).toDecimalPlaces(2).toFixed(2);

    const redisBid = await placeAuctionBidInRedis({
      auctionId: auctionListingId,
      bidderId: bidderUserId,
      bidAmountUsd: biddingPriceUsd,
      minAcceptedBidUsd: minAccepted,
      triggerWindowMs: ANTI_SNIPING_TRIGGER_WINDOW_MS,
      extensionMs: ANTI_SNIPING_EXTENSION_MS,
      requiredCoverageMultiplier: AUCTION_BID_PREMIUM_MULTIPLIER
    });

    if (!redisBid.ok) {
      if (redisBid.reason === "not_configured") {
        throw new AppError("Redis is not configured.", 503);
      }
      if (redisBid.reason === "not_started") {
        throw new AppError("Auction timer has not been started.", 400);
      }
      if (redisBid.reason === "ended") {
        throw new AppError("Auction has already ended.", 400);
      }
      if (redisBid.reason === "below_minimum") {
        throw new AppError(`Bid must be at least ${minAccepted}.`, 400);
      }
      if (redisBid.reason === "same_bidder") {
        throw new AppError("Current highest bidder cannot outbid themselves.", 400);
      }
      if (redisBid.reason === "not_higher") {
        throw new AppError("Bid must be higher than the current highest bid.", 400);
      }
      if (redisBid.reason === "wallet_missing") {
        throw new AppError("Bid wallet not initialized. Call bid init first.", 400);
      }
      if (redisBid.reason === "insufficient") {
        throw new AppError("Insufficient wallet balance for this bid.", 400);
      }
      if (redisBid.reason === "sealed_phase_active") {
        throw new AppError(
          "This auction is in the sealed-bid phase. Use POST /auctions/:auctionId/bids/sealed with biddingPriceUsd.",
          400
        );
      }
      throw new AppError("Invalid bid request.", 400);
    }

    const nextIncrementUsd =
      (await this.repository.getMinIncrementForCurrentPrice(redisBid.acceptedBidUsd)) ??
      this.defaultIncrementFor(redisBid.acceptedBidUsd);
    const minNextBidUsd = new Decimal(redisBid.acceptedBidUsd)
      .plus(new Decimal(nextIncrementUsd))
      .toDecimalPlaces(2)
      .toFixed(2);
    const endTimeIso = new Date(redisBid.endTimeMs).toISOString();
    const bidderWalletBalanceUsd =
      (await getAuctionWalletBalanceFromCache(auctionListingId, bidderUserId)) ?? "0.00";
    const walletUpdates: Array<{ userId: string; walletBalanceUsd: string }> = [
      { userId: bidderUserId, walletBalanceUsd: bidderWalletBalanceUsd }
    ];
    const previousHighestBidderId = cachedHighest?.bidderId?.trim() ?? "";
    if (previousHighestBidderId && previousHighestBidderId !== bidderUserId) {
      const outbidWalletBalanceUsd = await getAuctionWalletBalanceFromCache(auctionListingId, previousHighestBidderId);
      if (outbidWalletBalanceUsd != null) {
        walletUpdates.push({
          userId: previousHighestBidderId,
          walletBalanceUsd: outbidWalletBalanceUsd
        });
      }
    }
    await markAuctionParticipant(
      auctionListingId,
      bidderUserId,
      Math.max(1, Math.ceil((redisBid.endTimeMs - Date.now()) / 1000))
    );

    await withTransaction(async (client) => {
      await this.repository.updateListingAfterBid(client, {
        auctionListingId,
        endTimeIso,
        sealedPhaseActive: redisBid.sealedPhaseStarted ? true : undefined
      });
      await this.repository.insertBidHistory(client, {
        auctionListingId,
        bidderId: bidderUserId,
        bidAmountUsd: redisBid.acceptedBidUsd
      });
    });

    const antiSnipingExtensionApplied = redisBid.endTimeMs > Date.parse(listing.endTime);
    void this.repository
      .insertAuctionCardBid({
        auctionListingId,
        userCardId: listing.userCardId,
        bidderId: bidderUserId,
        bidAmountUsd: redisBid.acceptedBidUsd,
        bidKind: "open",
        listingEndTimeAfterBidIso: endTimeIso,
        antiSnipingExtensionApplied,
        sealedPhaseStartedThisBid: redisBid.sealedPhaseStarted
      })
      .catch((err) => {
        console.error("[auction] async auction_card_bids insert failed", err);
      });

    const bidHistory = await this.repository.listBidHistory(auctionListingId, 20);
    const broadcastPayload: AuctionBidBroadcastPayload = {
      type: "auction_bid_updated",
      auctionListingId,
      bidderId: bidderUserId,
      bidUsd: redisBid.acceptedBidUsd,
      endTime: endTimeIso,
      minNextBidUsd,
      walletUpdates,
      incrementUsd: nextIncrementUsd,
      antiSnipingApplied: redisBid.endTimeMs > Date.parse(listing.endTime),
      bidHistory,
      updatedAt: new Date().toISOString(),
      sealedPhaseActive: redisBid.sealedPhaseStarted
    };
    await publishAuctionBidUpdated(broadcastPayload);
    if (redisBid.sealedPhaseStarted) {
      await publishAuctionSealedPhaseStarted({
        auctionListingId,
        endTime: endTimeIso,
        reason: "anti_snipe_threshold"
      });
    }

    return {
      auctionListingId,
      bidderId: bidderUserId,
      bidUsd: redisBid.acceptedBidUsd,
      endTime: endTimeIso,
      minNextBidUsd,
      walletBalanceUsd: bidderWalletBalanceUsd,
      incrementUsd: nextIncrementUsd,
      antiSnipingApplied: broadcastPayload.antiSnipingApplied,
      sealedPhaseStarted: redisBid.sealedPhaseStarted
    };
  }

  async placeSealedBid(
    auctionListingId: string,
    bidderUserId: string,
    biddingPriceUsdRaw: string
  ): Promise<PlaceSealedAuctionBidResult> {
    if (!auctionListingId.trim() || !bidderUserId.trim()) {
      throw new AppError("Auction id and bidder id are required.", 400);
    }
    const biddingPriceUsd = this.assertPositiveMoneyString(biddingPriceUsdRaw, "bid amount");

    const listing = await this.repository.getAuctionListingById(auctionListingId);
    if (!listing) {
      throw new AppError("Auction listing not found.", 404);
    }
    if (listing.status !== "live") {
      throw new AppError("Auction is not live yet.", 400);
    }
    if (listing.sellerId === bidderUserId) {
      throw new AppError("Seller cannot bid on their own auction.", 400);
    }
    const sealedActive = (await isSealedPhaseActiveInRedis(auctionListingId)) || listing.sealedPhaseActive;
    if (!sealedActive) {
      throw new AppError("Sealed bids are only accepted during the sealed-bid phase.", 400);
    }

    const countdown = await getAuctionCountdownState(auctionListingId);
    if (!countdown.ok) {
      if (countdown.reason === "not_configured") {
        throw new AppError("Redis is not configured.", 503);
      }
      if (countdown.reason === "not_started") {
        throw new AppError("Auction timer has not been started.", 400);
      }
      throw new AppError("Auction has already ended.", 400);
    }

    const bidderDbBalance = await this.repository.getUserBalance(bidderUserId);
    if (bidderDbBalance == null) {
      throw new AppError("User not found.", 404);
    }
    await getOrPrimeWalletBalance(
      userWalletBalanceKey(bidderUserId),
      bidderDbBalance,
      Math.max(1, Math.ceil(countdown.ttlMs / 1000))
    );

    await this.assertBidWithinJustTcgReferenceCap(auctionListingId, biddingPriceUsd);

    if (await this.userHasSubmittedSealedBid(auctionListingId, bidderUserId)) {
      throw new AppError("You have already submitted a sealed bid for this auction.", 400);
    }

    const cachedHighest = await getCachedHighestBidState(auctionListingId);
    const currentBidUsd = cachedHighest?.bidUsd ?? listing.startBidUsd;
    const incrementUsd =
      (await this.repository.getMinIncrementForCurrentPrice(currentBidUsd)) ??
      this.defaultIncrementFor(currentBidUsd);
    const minAccepted = new Decimal(currentBidUsd).plus(new Decimal(incrementUsd)).toDecimalPlaces(2).toFixed(2);

    const redisBid = await placeSealedAuctionBidInRedis({
      auctionId: auctionListingId,
      bidderId: bidderUserId,
      bidAmountUsd: biddingPriceUsd,
      minAcceptedBidUsd: minAccepted,
      requiredCoverageMultiplier: AUCTION_BID_PREMIUM_MULTIPLIER
    });

    if (!redisBid.ok) {
      if (redisBid.reason === "not_configured") {
        throw new AppError("Redis is not configured.", 503);
      }
      if (redisBid.reason === "not_started") {
        throw new AppError("Auction timer has not been started.", 400);
      }
      if (redisBid.reason === "ended") {
        throw new AppError("Auction has already ended.", 400);
      }
      if (redisBid.reason === "below_minimum") {
        throw new AppError(`Sealed bid must be at least ${minAccepted}.`, 400);
      }
      if (redisBid.reason === "wallet_missing") {
        throw new AppError("Bid wallet not initialized. Call bid init first.", 400);
      }
      if (redisBid.reason === "insufficient") {
        throw new AppError("Insufficient wallet balance for this bid.", 400);
      }
      if (redisBid.reason === "sealed_phase_inactive") {
        throw new AppError("Sealed bids are only accepted during the sealed-bid phase.", 400);
      }
      if (redisBid.reason === "already_submitted") {
        throw new AppError("You have already submitted a sealed bid for this auction.", 400);
      }
      throw new AppError("Invalid sealed bid request.", 400);
    }

    const endTimeIso = new Date(redisBid.endTimeMs).toISOString();
    const ciphertext = encryptSealedBidAmountPlaintext(biddingPriceUsd);

    await withTransaction(async (client) => {
      await this.repository.upsertSealedBidRecord(client, {
        auctionListingId,
        bidderId: bidderUserId,
        amountCiphertext: ciphertext
      });
    });

    void this.repository
      .insertAuctionCardBid({
        auctionListingId,
        userCardId: listing.userCardId,
        bidderId: bidderUserId,
        bidAmountUsd: biddingPriceUsd,
        bidKind: "sealed",
        listingEndTimeAfterBidIso: endTimeIso,
        antiSnipingExtensionApplied: false,
        sealedPhaseStartedThisBid: true
      })
      .catch((err) => {
        console.error("[auction] async auction_card_bids sealed insert failed", err);
      });

    await markAuctionParticipant(
      auctionListingId,
      bidderUserId,
      Math.max(1, Math.ceil((redisBid.endTimeMs - Date.now()) / 1000))
    );

    return {
      auctionListingId,
      endTime: endTimeIso,
      walletBalanceUsd: redisBid.walletBalanceUsd,
      sealedPhaseActive: true,
      hasSubmittedSealedBid: true
    };
  }

  /**
   * When a slot goes live: fetch JustTCG price per listing card, cache reference USD in Redis (TTL covers auction).
   * Falls back to catalog `market_value_usd` if the API returns nothing. Used for max bid = N× reference.
   */
  private async prefetchJustTcgReferencePricesForListings(
    listingIds: string[],
    slotEndMs: number
  ): Promise<void> {
    const redis = getAuctionRedis();
    if (!redis || listingIds.length === 0) {
      return;
    }
    const rows = await this.repository.listCatalogReferenceForAuctionListings(listingIds);
    const ttlSeconds = Math.max(300, Math.ceil((slotEndMs - Date.now()) / 1000) + 600);
    const staggerMs = 150;
    for (const row of rows) {
      let usdNum: number | null = await fetchJustTcgCardPriceUsdByCardId(row.externalCardId);
      if (usdNum == null || !Number.isFinite(usdNum) || usdNum <= 0) {
        usdNum = Number(row.marketValueUsd);
      }
      if (!Number.isFinite(usdNum) || usdNum <= 0) {
        console.warn("[auction] No JustTCG/DB reference for bid cap; listing skipped", {
          listingId: row.listingId,
          externalCardId: row.externalCardId
        });
      } else {
        const usd = new Decimal(usdNum).toDecimalPlaces(2).toFixed(2);
        await redis.set(auctionListingJustTcgRefUsdKey(row.listingId), usd, "EX", ttlSeconds);
      }
      await new Promise((resolve) => setTimeout(resolve, staggerMs));
    }
  }

  private async assertBidWithinJustTcgReferenceCap(
    auctionListingId: string,
    bidAmountUsd: string
  ): Promise<void> {
    const ref = await getAuctionListingJustTcgRefUsd(auctionListingId);
    if (ref == null || ref.trim() === "") {
      return;
    }
    const maxBid = new Decimal(ref).mul(AUCTION_MAX_BID_VS_JUSTTCG_REFERENCE_MULTIPLIER);
    if (new Decimal(bidAmountUsd).greaterThan(maxBid)) {
      throw new AppError(
        `Bid cannot exceed ${AUCTION_MAX_BID_VS_JUSTTCG_REFERENCE_MULTIPLIER}× the auction reference price (${maxBid.toDecimalPlaces(2).toFixed(2)} USD).`,
        400
      );
    }
  }

  private parseStartBid(raw: string | undefined, fallbackMarketValueUsd: string): string {
    const source = raw?.trim() ? raw.trim() : fallbackMarketValueUsd.trim();
    const amount = new Decimal(source);
    if (!amount.isFinite() || amount.decimalPlaces()! > 2) {
      throw new AppError("Starting bid must be a valid amount with up to 2 decimal places.", 400);
    }
    if (amount.lessThanOrEqualTo(0)) {
      throw new AppError("Starting bid must be greater than zero.", 400);
    }
    return amount.toDecimalPlaces(2).toFixed(2);
  }

  private parseReservePrice(raw: string | undefined, startBidUsd: string): string | null {
    if (!raw || raw.trim() === "") {
      return null;
    }
    const reserve = new Decimal(raw.trim());
    if (!reserve.isFinite() || reserve.decimalPlaces()! > 2) {
      throw new AppError("Reserve price must be a valid amount with up to 2 decimal places.", 400);
    }
    if (reserve.lessThanOrEqualTo(0)) {
      throw new AppError("Reserve price must be greater than zero when provided.", 400);
    }
    const start = new Decimal(startBidUsd);
    if (reserve.lessThan(start)) {
      throw new AppError("Reserve price cannot be lower than the starting bid.", 400);
    }
    return reserve.toDecimalPlaces(2).toFixed(2);
  }

  private assertPositiveMoneyString(raw: string, label: string): string {
    const amount = new Decimal(raw.trim());
    if (!amount.isFinite() || amount.decimalPlaces()! > 2) {
      throw new AppError(`${label} must be a valid amount with up to 2 decimal places.`, 400);
    }
    if (amount.lessThanOrEqualTo(0)) {
      throw new AppError(`${label} must be greater than zero.`, 400);
    }
    return amount.toDecimalPlaces(2).toFixed(2);
  }

  private defaultIncrementFor(currentPriceUsd: string): string {
    const price = new Decimal(currentPriceUsd);
    if (price.lessThanOrEqualTo(0.99)) return "0.05";
    if (price.lessThanOrEqualTo(4.99)) return "0.25";
    if (price.lessThanOrEqualTo(24.99)) return "0.50";
    if (price.lessThanOrEqualTo(99.99)) return "1.00";
    if (price.lessThanOrEqualTo(249.99)) return "2.50";
    if (price.lessThanOrEqualTo(499.99)) return "5.00";
    if (price.lessThanOrEqualTo(999.99)) return "10.00";
    return "25.00";
  }

  /** DB stores slot duration in minutes. Convert to milliseconds for timers/TTLs. */
  private slotDurationMinutesToMs(durationMinutesRaw: number): number {
    const minutes =
      Number.isFinite(durationMinutesRaw) && durationMinutesRaw > 0
        ? durationMinutesRaw
        : DEFAULT_AUCTION_DURATION_MINUTES;
    return Math.max(1, Math.round(minutes * 60 * 1000));
  }

  async processDueSlotTransitions(nowIso: string = new Date().toISOString()): Promise<{ startedSlotIds: string[] }> {
    const startedSlotIds: string[] = [];
    const dueStarts = await this.repository.findSlotsReadyToStart(nowIso);

    for (const slotId of dueStarts) {
      try {
        await this.startAuction(slotId, "00000000-0000-0000-0000-000000000000");
        startedSlotIds.push(slotId);
      } catch (error) {
        console.error(`[auctionLifecycle] failed to start slot ${slotId}`, error);
      }
    }

    return { startedSlotIds };
  }
}
