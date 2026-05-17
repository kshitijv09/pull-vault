/**
 * Shared types for the B5 Platform Health Dashboard.
 *
 * The dashboard is split into four panels (fraud, economics, fairness audit,
 * user health) plus an alerts strip. Each panel has its own response shape so
 * the FE can re-render independently and the service layer can cache them
 * at different TTLs (see `platformHealth.service.ts`).
 */

import type { EarningsTimeRangePreset } from "./earningsAnalytics.types";

export type PlatformHealthRangePreset = EarningsTimeRangePreset;

export interface PlatformHealthWindow {
  fromIso: string | null;
  toIso: string | null;
  rangePreset: PlatformHealthRangePreset | null;
}

/* ── Fraud ─────────────────────────────────────────────────────────────── */

export type RateLimitBlockScope =
  | "user_global"
  | "user_drop"
  | "ip_global"
  | "ip_drop";

export interface RateLimitBlockSummary {
  totalBlocks: number;
  /** Total accepted pack purchases over the same window (denominator). */
  totalAcceptedPurchases: number;
  /** `blocks / (blocks + accepted)` as a string with 4 decimal places; null if both zero. */
  blockShareOfAttempts: string | null;
  byScope: Array<{ scope: RateLimitBlockScope; count: number }>;
}

export interface TopBlockedIp {
  clientIp: string;
  blocks: number;
  shareOfTotal: string;
}

export interface FraudPanel {
  rateLimit: RateLimitBlockSummary;
  topBlockedIps: TopBlockedIp[];
  /** Reused from `AuctionAnalyticsService.getSummary` — same calculation. */
  auctionFraud: {
    settledCount: number;
    needsFraudReviewCount: number;
    flagRate: string | null;
    sealedPhaseRate: string | null;
  };
}

/* ── Economics ─────────────────────────────────────────────────────────── */

export interface TierMarginRow {
  tierName: string;
  /** Pack count in the window for this tier (denominator). */
  packsOpened: number;
  retailRevenueUsd: string;
  realisedValueUsd: string;
  /** `1 - realised/retail`. Positive = house keeps it; negative = house lost money. */
  actualMargin: string | null;
  /** `1 - targetPackValueRatio` from `packGenerator.config.ts`. */
  targetMargin: string;
  /** `actualMargin - targetMargin`. Positive = above target (good); negative = breach. */
  marginGapPp: string | null;
  /** Share of packs whose realised value ≥ retail. */
  winRate: string | null;
}

export interface RevenueProjection {
  totalRevenueUsd: string;
  /** Linear projection from the last 24h burn rate. */
  projectedNext24hUsd: string;
  /** Linear projection from the last 7d burn rate. */
  projectedNext7dUsd: string;
}

export interface PoolDriftRow {
  dropId: string;
  dropName: string;
  poolSnapshotCreatedAt: string;
  medianDriftPct: string;
  maxDriftPct: string;
  cardsCompared: number;
}

export interface EconomicsPanel {
  tiers: TierMarginRow[];
  revenue: {
    packPurchase: RevenueProjection;
    marketplacePurchase: RevenueProjection;
    auctionCompletion: RevenueProjection;
    total: RevenueProjection;
  };
  pools: PoolDriftRow[];
}

/* ── Fairness audit ────────────────────────────────────────────────────── */

export interface ChiSquaredBucket {
  rarity: string;
  observed: number;
  expected: number;
  /** Standardised residual `(O - E) / sqrt(E)` — flags rarities driving the gap. */
  standardisedResidual: string;
  /** Dropped because `expected < EXPECTED_COUNT_FLOOR`. */
  dropped: boolean;
}

export interface ChiSquaredResult {
  tierName: string;
  totalCardsObserved: number;
  degreesOfFreedom: number;
  chiSquared: string;
  /** `null` when sample is below `N ≥ 30 × (k - 1)`. */
  pValue: string | null;
  /** α used after Bonferroni correction (single test for single tier, α/T for multi-tier). */
  alpha: string;
  decision: "accept" | "reject" | "insufficient_data";
  buckets: ChiSquaredBucket[];
}

export interface FairnessUsageRow {
  totalConsumedCommits: number;
  totalReveals: number;
  distinctUserPacksVerified: number;
  totalVerifyEvents: number;
  failedVerifyEvents: number;
}

export interface FairnessPanel {
  usage: FairnessUsageRow;
  chiSquared: {
    perTier: ChiSquaredResult[];
    overallDecision: "accept" | "reject" | "insufficient_data";
    bonferroniAlpha: string;
  };
}

/* ── User health ───────────────────────────────────────────────────────── */

export interface UserHealthPanel {
  dau: number;
  wau: number;
  mau: number;
  dauOverMau: string | null;
  /** Distinct buyers / distinct logins over recent live drop window(s). */
  dropParticipationRate: string | null;
  auctionParticipationRate: string | null;
  packToListConversion24h: string | null;
  /** D1 / D7 / D30 retention for the most recent fully-elapsed cohort. */
  retention: {
    cohortStart: string | null;
    d1: string | null;
    d7: string | null;
    d30: string | null;
  };
  badge: "green" | "yellow" | "red";
  badgeBreakdown: Array<{
    signal: string;
    status: "green" | "yellow" | "red";
    value: string | null;
  }>;
}

/* ── Alerts ────────────────────────────────────────────────────────────── */

export type HealthAlertKey =
  | "rate_limit_pressure"
  | "single_ip_spike"
  | "auction_fraud_flag_spike"
  | "tier_margin_breach"
  | "tier_win_rate_breach"
  | "revenue_drop"
  | "pool_price_drift"
  | "rarity_distribution_breach"
  | "verifier_failures"
  | "pool_snapshot_stale";

export type HealthAlertSeverity = "info" | "warning" | "critical";

export interface HealthAlertRow {
  id: string;
  alertKey: HealthAlertKey;
  severity: HealthAlertSeverity;
  firedAt: string;
  resolvedAt: string | null;
  context: Record<string, unknown>;
}

/* ── Compound summary ──────────────────────────────────────────────────── */

export interface PlatformHealthSummaryResponse {
  window: PlatformHealthWindow;
  fraud: FraudPanel;
  economics: EconomicsPanel;
  fairness: FairnessPanel;
  users: UserHealthPanel;
  /** Currently-firing alerts (resolved_at IS NULL). */
  openAlerts: HealthAlertRow[];
  /** Last 50 alert firings, most recent first. Includes resolved. */
  recentAlerts: HealthAlertRow[];
}
