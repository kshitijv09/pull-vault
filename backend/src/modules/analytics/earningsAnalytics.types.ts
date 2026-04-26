export type EarningsEventType = "marketplace_purchase" | "auction_completion" | "pack_purchase";

export type EarningsTimeRangePreset = "24h" | "7d" | "30d" | "90d" | "ytd" | "all";
export type EarningsSortOrder = "asc" | "desc";
export type EarningsGroupBy = "hour" | "day" | "week" | "month";

export interface EarningsWindow {
  fromIso: string | null;
  toIso: string | null;
}

export interface EarningsSummary {
  totalAmountGainedUsd: string;
  totalEvents: number;
  averagePerEventUsd: string;
  largestSingleGainUsd: string;
}

export interface EarningsSourceBreakdownRow {
  eventType: EarningsEventType;
  totalAmountGainedUsd: string;
  totalEvents: number;
  averagePerEventUsd: string;
}

export interface EarningsTimeseriesPoint {
  bucketStart: string;
  totalAmountGainedUsd: string;
  totalEvents: number;
}

export interface EarningsLedgerEventRow {
  id: string;
  eventType: EarningsEventType;
  transactionId: string;
  amountGainedUsd: string;
  currencyCode: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EarningsOverviewResponse {
  window: EarningsWindow;
  filters: {
    eventTypes: EarningsEventType[];
    rangePreset: EarningsTimeRangePreset | null;
  };
  summary: EarningsSummary;
  sourceBreakdown: EarningsSourceBreakdownRow[];
}

export interface EarningsTimeseriesResponse {
  window: EarningsWindow;
  filters: {
    eventTypes: EarningsEventType[];
    rangePreset: EarningsTimeRangePreset | null;
    groupBy: EarningsGroupBy;
  };
  points: EarningsTimeseriesPoint[];
}

export interface EarningsEventsResponse {
  window: EarningsWindow;
  filters: {
    eventTypes: EarningsEventType[];
    rangePreset: EarningsTimeRangePreset | null;
  };
  pagination: {
    limit: number;
    offset: number;
  };
  sort: {
    by: "occurred_at" | "amount_gained_usd" | "event_type" | "created_at";
    order: EarningsSortOrder;
  };
  events: EarningsLedgerEventRow[];
}
