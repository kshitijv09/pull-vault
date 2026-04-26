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
}
