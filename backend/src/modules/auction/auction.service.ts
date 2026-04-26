import Decimal from "decimal.js";
import {
  auctionWalletKey,
  cacheAuctionEndTimeWithTtl,
  creditCachedWalletBalance,
  getAuctionWalletBalanceFromCache,
  getCachedHighestBidState,
  getAuctionCountdownState,
  getAuctionRedis,
  getOrPrimeWalletBalance,
  markAuctionParticipant,
  placeAuctionBidInRedis,
  publishAuctionBidUpdated,
  userWalletBalanceKey
} from "../../infra/redis/auctionWalletStore";
import { withTransaction } from "../../db/transaction";
import { AppError } from "../../shared/errors/AppError";
import { AUCTION_BID_PREMIUM_MULTIPLIER } from "../../shared/constants/premiums";
import { AuctionRepository } from "./auction.repository";
import type {
  AuctionBidBroadcastPayload,
  AuctionBidInitResult,
  AuctionListingsFilter,
  AuctionListingRow,
  AuctionListingStatus,
  GoLiveAuctionResult,
  PlaceAuctionBidResult,
  StartAuctionResult
} from "./auction.types";

const DEFAULT_SLOT_CAPACITY = 100;
const DEFAULT_AUCTION_DURATION_MINUTES = 10;
const ANTI_SNIPING_TRIGGER_WINDOW_MS = 30 * 1000;
const ANTI_SNIPING_EXTENSION_MS = 30 * 1000;

export class AuctionService {
  constructor(private readonly repository: AuctionRepository) {}

  async getSlots(slotStatusRaw?: string) {
    const filter = slotStatusRaw ? { slotStatus: slotStatusRaw as any } : undefined;
    return this.repository.listSlots(filter);
  }

  async getAuctions(filter?: AuctionListingsFilter): Promise<AuctionListingRow[]> {
    return this.repository.listAuctions(filter);
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

    return withTransaction(async (client) => {
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

      let created: { id: string };
      try {
        created = await this.repository.createAuctionListing(client, {
          slotId: slot.id,
          userCardId: cardRow.userCardId,
          sellerId: ownerUserId,
          startBidUsd,
          reservePriceUsd,
          endTimeIso: endTime.toISOString(),
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
        sellingStatus: "listed_for_auction",
        slotId: slot.id,
        listingStatus
      };
    });
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

    return withTransaction(async (client) => {
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

      let created: { id: string };
      try {
        created = await this.repository.createAuctionListing(client, {
          slotId: slotRow.id,
          userCardId: cardRow.userCardId,
          sellerId: ownerUserId,
          startBidUsd,
          reservePriceUsd,
          endTimeIso: endTime.toISOString(),
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
        sellingStatus: "listed_for_auction",
        slotId: slotRow.id,
        listingStatus
      };
    });
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

    return {
      auctionListingId: listing.id,
      endTime: listing.endTime,
      minBidUsd,
      walletBalanceUsd: walletState.balanceUsd,
      walletSource: walletState.source
    };
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
        endTimeIso
      });
      await this.repository.insertBidHistory(client, {
        auctionListingId,
        bidderId: bidderUserId,
        bidAmountUsd: redisBid.acceptedBidUsd
      });
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
      updatedAt: new Date().toISOString()
    };
    await publishAuctionBidUpdated(broadcastPayload);

    return {
      auctionListingId,
      bidderId: bidderUserId,
      bidUsd: redisBid.acceptedBidUsd,
      endTime: endTimeIso,
      minNextBidUsd,
      walletBalanceUsd: bidderWalletBalanceUsd,
      incrementUsd: nextIncrementUsd,
      antiSnipingApplied: broadcastPayload.antiSnipingApplied
    };
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
