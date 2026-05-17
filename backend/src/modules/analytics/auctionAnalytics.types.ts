import type { EarningsTimeRangePreset } from "./earningsAnalytics.types";

/** Re-use dashboard presets (`range`) identical to earnings analytics */
export type AuctionAnalyticsRangePreset = EarningsTimeRangePreset;

export type AuctionAnalyticsGroupBy = "day" | "week" | "month";

export interface AuctionAnalyticsWindow {
  fromIso: string | null;
  toIso: string | null;
}

export interface AuctionAnalyticsSummaryResponse {
  window: AuctionAnalyticsWindow;
  filters: {
    rangePreset: AuctionAnalyticsRangePreset | null;
    snipeWindowSeconds: number;
  };
  settledAuctions: {
    settledListingTotalCount: number;
    soldCount: number;
    unsoldCount: number;
    listingsWithOpenBidActivityCount: number;
    /** `listingsWithOpenBidActivityCount / settledListingTotalCount`; null if denominator zero */
    participationRateListingsWithOpenBids: string | null;
    avgDistinctOpenBiddersAmongListingsWithBids: string | null;
    avgOpenBidRowsPerListingWithBids: string | null;
  };
  pricingVsMarket: {
    soldListingsWithPositiveMarketCount: number;
    avgFinalBidToMarketRatio: string | null;
    medianFinalBidToMarketRatio: string | null;
  };
  sniping: {
    /** Sold listings that had at least one open-phase bid (basis for rate) */
    soldWithOpenBidHistoryCount: number;
    soldWhereLastOpenBidInSnipeWindowCount: number;
    /** Last open `bid_at` within snipe window before `end_time` */
    openPhaseLastBidSnipeRate: string | null;
  };
  flags: {
    needsFraudReviewCount: number;
    /** Among settled listings in window */
    fraudReviewFlagRate: string | null;
  };
  sealedPhase: {
    listingsEnteredSealedPhaseCount: number;
    sealedPhaseRateAmongSettled: string | null;
  };
}

export interface AuctionAnalyticsTimeseriesPoint {
  bucketStart: string;
  settledListingCount: number;
  soldCount: number;
  unsoldCount: number;
  listingsWithOpenBidActivityCount: number;
  needsFraudReviewCount: number;
}

export interface AuctionAnalyticsTimeseriesResponse {
  window: AuctionAnalyticsWindow;
  filters: {
    rangePreset: AuctionAnalyticsRangePreset | null;
    groupBy: AuctionAnalyticsGroupBy;
  };
  points: AuctionAnalyticsTimeseriesPoint[];
}
