export type AuctionSlotStatus = "scheduled" | "active" | "completed" | "cancelled";
export type AuctionListingStatus = "pending" | "live" | "sold" | "unsold";

export interface AuctionListingRow {
  id: string | null;
  slotId: string;
  cardId: string | null;
  sellerId: string | null;
  startBidUsd: string | null;
  reservePriceUsd: string | null;
  highestBidUsd: string | null;
  highestBidderId: string | null;
  endTime: string | null;
  status: AuctionListingStatus | null;
  slotStatus: AuctionSlotStatus;
  slotStartTime: string;
  cardName: string | null;
  cardSet: string | null;
  cardRarity: string | null;
  cardImageUrl: string | null;
  needsFraudReview: boolean | null;
}

export interface AuctionFraudReviewResult {
  auctionListingId: string;
  needsFraudReview: boolean;
  h1RepeatPairSuspicion: boolean;
  h2UncontestedLowPriceSuspicion: boolean;
  /** H3: sold — non-winner (excl. seller) placed ≥ threshold open bids on this listing */
  h3HeavyNonWinnerOpenBidsSuspicion: boolean;
  /** H6: rapid same-bidder bursts and/or open bids not respecting configured min increment vs prior standing bid */
  h6SingleAccountBidSpamSuspicion: boolean;
  heuristics: {
    pairTradeCountInWindow: number;
    repeatPairWindowDays: number;
    distinctOpenBidders: number | null;
    priceToMarketRatio: string | null;
    h3MaxNonWinnerOpenBidCount: number;
    h3MinOpenBidsNonWinnerThreshold: number;
    h6MaxBidsInRollingWindow: number;
    h6BidSpamWindowSeconds: number;
    h6IncrementViolationCount: number;
  };
}

export interface AuctionListingsFilter {
  slotId?: string;
  slotStatus?: AuctionSlotStatus;
  listingStatus?: AuctionListingStatus;
}

export interface GoLiveAuctionResult {
  auctionListingId: string;
  userCardId: string;
  sellingStatus: "listed_for_auction";
  slotId: string;
  listingStatus: AuctionListingStatus;
}

export interface StartAuctionResult {
  auctionSlotId: string;
  endTime: string;
  startedListingIds: string[];
  status: AuctionListingStatus;
}

export interface AuctionBidInitResult {
  auctionListingId: string;
  endTime: string;
  minBidUsd: string;
  walletBalanceUsd: string;
  walletSource: "cache" | "db";
  sealedPhaseActive: boolean;
  /** True when this bidder already locked a sealed bid for this listing. */
  hasSubmittedSealedBid: boolean;
}

export interface PlaceAuctionBidResult {
  auctionListingId: string;
  bidderId: string;
  bidUsd: string;
  endTime: string;
  minNextBidUsd: string;
  walletBalanceUsd: string;
  incrementUsd: string;
  antiSnipingApplied: boolean;
  sealedPhaseStarted: boolean;
}

export interface PlaceSealedAuctionBidResult {
  auctionListingId: string;
  endTime: string;
  walletBalanceUsd: string;
  sealedPhaseActive: true;
  hasSubmittedSealedBid: true;
}

export interface AuctionSealedPhaseStartedPayload {
  type: "auction_sealed_phase_started";
  auctionListingId: string;
  endTime: string;
  reason: "anti_snipe_threshold";
  updatedAt: string;
}

export interface AuctionBidHistoryEntry {
  id: string;
  auctionListingId: string;
  bidderId: string;
  bidAmountUsd: string;
  bidAt: string;
}

export interface AuctionBidBroadcastPayload {
  type: "auction_bid_updated";
  auctionListingId: string;
  bidderId: string;
  bidUsd: string;
  endTime: string;
  minNextBidUsd: string;
  walletUpdates?: Array<{ userId: string; walletBalanceUsd: string }>;
  incrementUsd: string;
  antiSnipingApplied: boolean;
  bidHistory: AuctionBidHistoryEntry[];
  updatedAt: string;
  /** When true, UI should treat the auction as entering or in sealed phase (no further public bid updates). */
  sealedPhaseActive?: boolean;
}
