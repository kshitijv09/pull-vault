import type {
  PackFairnessPoolSnapshotResponse,
  PackFairnessRevealResponse
} from "./fairness/types";

const defaultBase = "http://localhost:4000/api";

export function getApiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.trim();
  return base && base.length > 0 ? base.replace(/\/$/, "") : defaultBase;
}

/** WebSocket URL for collection card subscriptions (same host as API, path `/ws/collection`). */
export function getCollectionWsUrl(token: string): string {
  const api = getApiBaseUrl();
  const u = new URL(api);
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${u.host}/ws/collection?token=${encodeURIComponent(token)}`;
}

/** WebSocket URL for auction subscriptions (same host as API, path `/ws/auction`). */
export function getAuctionWsUrl(token: string): string {
  const api = getApiBaseUrl();
  const u = new URL(api);
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${u.host}/ws/auction?token=${encodeURIComponent(token)}`;
}

/** WebSocket URL for pack availability subscriptions. */
export function getPackAvailabilityWsUrl(token: string): string {
  const api = getApiBaseUrl();
  const u = new URL(api);
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${u.host}/ws/pack-availability?token=${encodeURIComponent(token)}`;
}

export type UserProfile = {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  currencyCode: string;
  balance: string;
  /** Funds reserved for auctions only (separate from `balance`). */
  auctionBalance?: string;
  createdAt: string;
};

export type PublicUserProfile = {
  id: string;
  fullName: string;
};

/** Distinct rarities and sets in the signed-in user’s collection (`GET /users/:userId/cards/facets`). */
export type UserOwnedCardFacets = {
  rarities: string[];
  cardSets: string[];
};

/** One owned card instance + catalog fields from `GET /users/:userId/cards`. */
export type UserOwnedCard = {
  userCardId: string;
  catalogCardId: string;
  /** `pack_inventory.id` the user_card was assigned to (legacy `pack_id` reference). */
  packId: string | null;
  /** `user_packs.id` — the owning pack purchase row. Used for fairness verification deep-links. */
  userPackId: string | null;
  cardId: string;
  name: string;
  cardSet: string;
  imageUrl: string;
  rarity: string;
  marketValueUsd: string;
  acquisitionPriceUsd: string;
  /** `unlisted` | `listed_for_sale` | `listed_for_auction`. */
  sellingStatus: string;
  /** Asking price when listed (`0` when not listed). Omitted on older API responses until migration runs. */
  listingPriceUsd?: string;
  obtainedAt: string;
};

export type PortfolioHistoryRange = "1d" | "1w" | "1m" | "ytd";

/** `GET /users/:userId/portfolio/value` — uses live Redis prices when available. */
export type PortfolioComputation = {
  totalPortfolioValueUsd: string;
  totalAcquisitionCostUsd: string;
  cardInstanceCount: number;
  usedFallbackPriceCount: number;
};

export type PortfolioSnapshotPoint = {
  id: string;
  totalPortfolioValueUsd: string;
  recordedAt: string;
};

/** `GET /users/:userId/portfolio/snapshots?range=` */
export type PortfolioSnapshotsPayload = {
  range: PortfolioHistoryRange;
  points: PortfolioSnapshotPoint[];
};

/** One row from `GET /marketplace/listings` or `GET /marketplace/browse`. */
export type MarketplaceListing = {
  userCardId: string;
  sellerUserId: string;
  catalogCardId: string;
  packId: string | null;
  cardId: string;
  name: string;
  cardSet: string;
  imageUrl: string;
  rarity: string;
  askingPriceUsd: string;
  buyerPremiumRatePercent: string;
  buyerPremiumUsd: string;
  buyerTotalPriceUsd: string;
  listedAt: string;
};

export type MarketplacePurchaseResponse = {
  newUserCardId: string;
  askingPriceUsd: string;
  buyerPremiumRatePercent: string;
  buyerPremiumUsd: string;
  pricePaidUsd: string;
  sellerUserId: string;
};

export type AuctionListingStatus = "pending" | "live" | "sold" | "unsold";
export type AuctionSlotStatus = "scheduled" | "active" | "completed" | "cancelled";

export type AuctionSlot = {
  id: string;
  status: AuctionSlotStatus;
  startTime: string;
  capacity: number;
  currentCapacity: number;
  duration: number;
  name: string | null;
};

/** One row from `GET /auctions/listings`. `id` is null when the slot has no listings yet (empty auction). */
export type AuctionListing = {
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
  needsFraudReview?: boolean | null;
};

/** `POST /auctions/:auctionId/fraud-review` — evaluates heuristics and updates listing.needsFraudReview. */
export type AuctionFraudReviewResponse = {
  auctionListingId: string;
  needsFraudReview: boolean;
  h1RepeatPairSuspicion: boolean;
  h2UncontestedLowPriceSuspicion: boolean;
  h3HeavyNonWinnerOpenBidsSuspicion: boolean;
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
};

export type AuctionBidHistoryEntry = {
  id: string;
  auctionListingId: string;
  bidderId: string;
  bidAmountUsd: string;
  bidAt: string;
};

export type AuctionBidInitResponse = {
  auctionListingId: string;
  endTime: string;
  minBidUsd: string;
  walletBalanceUsd: string;
  walletSource: "cache" | "db";
  sealedPhaseActive: boolean;
  hasSubmittedSealedBid: boolean;
};

export type PlaceAuctionBidResponse = {
  auctionListingId: string;
  bidderId: string;
  bidUsd: string;
  endTime: string;
  minNextBidUsd: string;
  walletBalanceUsd: string;
  incrementUsd: string;
  antiSnipingApplied: boolean;
  sealedPhaseStarted: boolean;
};

export type PlaceSealedAuctionBidResponse = {
  auctionListingId: string;
  endTime: string;
  walletBalanceUsd: string;
  sealedPhaseActive: true;
  hasSubmittedSealedBid: true;
};

export type StartAuctionResponse = {
  auctionSlotId: string;
  endTime: string;
  startedListingIds?: string[];
  status: AuctionListingStatus;
};

export type AuctionSnapshotSocketMessage = {
  type: "auction_snapshot";
  auctionListingId: string;
  currentBidUsd: string;
  currentBidderId: string | null;
  endTime: string;
  minNextBidUsd: string;
  viewerCount: number;
  walletBalanceUsd?: string;
  bidHistory: AuctionBidHistoryEntry[];
  updatedAt: string;
  sealedPhaseActive?: boolean;
};

export type AuctionBidUpdatedSocketMessage = {
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
  sealedPhaseActive?: boolean;
};

export type AuctionSealedPhaseStartedSocketMessage = {
  type: "auction_sealed_phase_started";
  auctionListingId: string;
  endTime: string;
  reason: "anti_snipe_threshold";
  updatedAt: string;
};

export type AuctionFinalizedSocketMessage = {
  type: "auction_finalized";
  auctionListingId: string;
  status: "sold" | "unsold";
  winnerUserId: string | null;
  winningBidUsd: string | null;
  winningBidSource?: "open" | "sealed" | null;
  cardName?: string | null;
  winnerName?: string | null;
  updatedAt: string;
};

export type AuctionViewerCountSocketMessage = {
  type: "auction_viewer_count_updated";
  auctionListingId: string;
  viewerCount: number;
  updatedAt: string;
};

export type AuctionSocketMessage =
  | AuctionSnapshotSocketMessage
  | AuctionBidUpdatedSocketMessage
  | AuctionSealedPhaseStartedSocketMessage
  | AuctionFinalizedSocketMessage
  | AuctionViewerCountSocketMessage;

export type LoginResponse = {
  token: string;
  user: UserProfile;
};

export type UnlistCardResponse = {
  listed: boolean;
  userCardId: string;
};

export type GoLiveAuctionResponse = {
  sellingStatus: string;
  userCardId: string;
};

/** `POST /auctions/slots/:slotId/listings` */
export type AddAuctionSlotListingResponse = {
  auctionListingId: string;
  userCardId: string;
  sellingStatus: "listed_for_auction";
  slotId: string;
  listingStatus: AuctionListingStatus;
};

export type ListForSaleResponse = {
  listed: boolean;
  userCardId: string;
  listingPriceUsd: string;
};

export type DepositFundsResponse = UserProfile;

export type PortfolioSnapshotCreateResponse = {
  id: string;
  userId: string;
  totalPortfolioValueUsd: string;
  totalAcquisitionCostUsd: string;
  cardInstanceCount: number;
  usedFallbackPriceCount: number;
  recordedAt: string;
};

export type EarningsEventType = "marketplace_purchase" | "auction_completion" | "pack_purchase";
export type EarningsRangePreset = "24h" | "7d" | "30d" | "90d" | "ytd" | "all";
export type EarningsSortOrder = "asc" | "desc";
export type EarningsGroupBy = "hour" | "day" | "week" | "month";

export type EarningsWindow = {
  fromIso: string | null;
  toIso: string | null;
};

export type EarningsSummary = {
  totalAmountGainedUsd: string;
  totalEvents: number;
  averagePerEventUsd: string;
  largestSingleGainUsd: string;
};

export type EarningsSourceBreakdownRow = {
  eventType: EarningsEventType;
  totalAmountGainedUsd: string;
  totalEvents: number;
  averagePerEventUsd: string;
};

export type EarningsOverviewResponse = {
  window: EarningsWindow;
  filters: {
    eventTypes: EarningsEventType[];
    rangePreset: EarningsRangePreset | null;
  };
  summary: EarningsSummary;
  sourceBreakdown: EarningsSourceBreakdownRow[];
};

export type EarningsTimeseriesPoint = {
  bucketStart: string;
  totalAmountGainedUsd: string;
  totalEvents: number;
};

export type EarningsTimeseriesResponse = {
  window: EarningsWindow;
  filters: {
    eventTypes: EarningsEventType[];
    rangePreset: EarningsRangePreset | null;
    groupBy: EarningsGroupBy;
  };
  points: EarningsTimeseriesPoint[];
};

export type EarningsLedgerEvent = {
  id: string;
  eventType: EarningsEventType;
  transactionId: string;
  amountGainedUsd: string;
  currencyCode: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type EarningsEventsResponse = {
  window: EarningsWindow;
  filters: {
    eventTypes: EarningsEventType[];
    rangePreset: EarningsRangePreset | null;
  };
  pagination: {
    limit: number;
    offset: number;
  };
  sort: {
    by: "occurred_at" | "amount_gained_usd" | "event_type" | "created_at";
    order: EarningsSortOrder;
  };
  events: EarningsLedgerEvent[];
};

type EarningsBaseQuery = {
  range?: EarningsRangePreset;
  from?: string;
  to?: string;
  eventTypes?: EarningsEventType[];
  order?: EarningsSortOrder;
};

type EarningsOverviewQuery = EarningsBaseQuery & {
  sortBy?: "amount" | "events" | "average";
};

type EarningsTimeseriesQuery = EarningsBaseQuery & {
  groupBy?: EarningsGroupBy;
};

type EarningsEventsQuery = EarningsBaseQuery & {
  sortBy?: "occurred_at" | "amount_gained_usd" | "event_type" | "created_at";
  limit?: number;
  offset?: number;
};

type ApiErrorBody = { error?: string; code?: string; details?: unknown };

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function buildApiErrorMessage(status: number, json: ApiErrorBody): string {
  const base =
    typeof json.error === "string" && json.error.length > 0
      ? json.error
      : `Request failed (${status})`;
  const code = typeof json.code === "string" && json.code.trim() ? json.code : "";
  return code ? `${base} [${code}]` : base;
}

export async function apiPostJson<TResponse>(
  path: string,
  body: Record<string, unknown>
): Promise<TResponse> {
  const url = `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("pullvault.auth");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.token) headers["Authorization"] = `Bearer ${parsed.token}`;
        if (parsed?.user?.id) headers["x-user-id"] = parsed.user.id;
      }
    } catch {}
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const json = (await response.json().catch(() => ({}))) as
    | ({ data: TResponse } & ApiErrorBody)
    | ApiErrorBody;

  if (!response.ok) {
    throw new ApiRequestError(
      buildApiErrorMessage(response.status, json),
      response.status,
      typeof json.code === "string" ? json.code : undefined,
      json.details
    );
  }

  if (!("data" in json)) {
    throw new ApiRequestError("Unexpected response shape.", response.status);
  }

  return json.data;
}

export async function apiGetJson<TResponse>(
  path: string,
  query?: Record<string, string | undefined>
): Promise<TResponse> {
  const search = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        search.set(key, value);
      }
    }
  }
  const qs = search.toString();
  const basePath = path.startsWith("/") ? path : `/${path}`;
  const url = `${getApiBaseUrl()}${basePath}${qs ? `?${qs}` : ""}`;
  
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("pullvault.auth");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.token) headers["Authorization"] = `Bearer ${parsed.token}`;
        if (parsed?.user?.id) headers["x-user-id"] = parsed.user.id;
      }
    } catch {}
  }

  const response = await fetch(url, {
    method: "GET",
    headers
  });

  const json = (await response.json().catch(() => ({}))) as
    | ({ data: TResponse } & ApiErrorBody)
    | ApiErrorBody;

  if (!response.ok) {
    throw new ApiRequestError(
      buildApiErrorMessage(response.status, json),
      response.status,
      typeof json.code === "string" ? json.code : undefined,
      json.details
    );
  }

  if (!("data" in json)) {
    throw new ApiRequestError("Unexpected response shape.", response.status);
  }

  return json.data;
}

export function getUserProfile(userId: string): Promise<UserProfile> {
  return apiGetJson<UserProfile>(`/users/${userId}`);
}

export function getPackFairnessReveal(userPackId: string): Promise<PackFairnessRevealResponse> {
  return apiGetJson<PackFairnessRevealResponse>(`/user-packs/${userPackId}/fairness-reveal`);
}

export function getDropFairnessPoolSnapshot(
  dropId: string
): Promise<PackFairnessPoolSnapshotResponse> {
  return apiGetJson<PackFairnessPoolSnapshotResponse>(`/drops/${dropId}/fairness-pool-snapshot`);
}

export type PackFairnessCommitResponse = {
  /** UUID; show in UI as "Fairness session ID". Passed to /pack-queue/purchases as `nonce`. */
  nonce: string;
  /** `SHA-256(server_secret)` lowercase hex (64 chars). */
  server_commitment: string;
  /** Final `client_seed` echoed back (either the user's trimmed input or a server-generated hex string). */
  client_seed: string;
  client_seed_source: "user" | "server";
};

/**
 * Phase 1 of the provably-fair scheme. Optional `clientSeed` (max 512 chars).
 * Server generates one if omitted / blank. Caller MUST persist the returned
 * `nonce` and pass it as `nonce` on the subsequent `/pack-queue/purchases`
 * call to bind the eventual draw to this commitment.
 */
export function commitPackFairness(
  dropId: string,
  clientSeed?: string
): Promise<PackFairnessCommitResponse> {
  const body: Record<string, unknown> = {};
  if (typeof clientSeed === "string" && clientSeed.trim().length > 0) {
    body.client_seed = clientSeed.trim();
  }
  return apiPostJson<PackFairnessCommitResponse>(`/drops/${dropId}/fairness-commit`, body);
}

/**
 * Fire-and-forget verifier beacon. Called by the browser-only verifier in
 * `app/(marketing)/verify/[userPackId]/page.tsx` after every replay so the
 * B5 fairness-audit panel can show "how many users used the verification."
 * Anonymous-OK (the endpoint is gated by `optionalAuthMiddleware`).
 *
 * Returns immediately and silently swallows any errors; an outage in the
 * audit pipeline must never block a verification result from being shown
 * to the user.
 */
export function reportPackFairnessVerifyEvent(
  userPackId: string,
  payload: { result: "pass" | "fail"; failingCheck?: string | null }
): Promise<void> {
  const url = `${getApiBaseUrl()}/user-packs/${userPackId}/fairness-verify-event`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("pullvault.auth");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.token) headers["Authorization"] = `Bearer ${parsed.token}`;
      }
    } catch {}
  }
  const body = JSON.stringify({
    result: payload.result,
    failingCheck: payload.failingCheck ?? null
  });
  return fetch(url, { method: "POST", headers, body, keepalive: true })
    .then(() => undefined)
    .catch(() => undefined);
}

/* ── Platform Health Dashboard (B5) ──────────────────────────────────── */

export type PlatformHealthRangePreset = EarningsRangePreset;

export type PlatformHealthWindow = {
  fromIso: string | null;
  toIso: string | null;
  rangePreset: PlatformHealthRangePreset | null;
};

export type RateLimitBlockScope = "user_global" | "user_drop" | "ip_global" | "ip_drop";

export type FraudPanel = {
  rateLimit: {
    totalBlocks: number;
    totalAcceptedPurchases: number;
    blockShareOfAttempts: string | null;
    byScope: Array<{ scope: RateLimitBlockScope; count: number }>;
  };
  topBlockedIps: Array<{ clientIp: string; blocks: number; shareOfTotal: string }>;
  auctionFraud: {
    settledCount: number;
    needsFraudReviewCount: number;
    flagRate: string | null;
    sealedPhaseRate: string | null;
  };
};

export type TierMarginRow = {
  tierName: string;
  packsOpened: number;
  retailRevenueUsd: string;
  realisedValueUsd: string;
  actualMargin: string | null;
  targetMargin: string;
  marginGapPp: string | null;
  winRate: string | null;
};

export type RevenueProjection = {
  totalRevenueUsd: string;
  projectedNext24hUsd: string;
  projectedNext7dUsd: string;
};

export type PoolDriftRow = {
  dropId: string;
  dropName: string;
  poolSnapshotCreatedAt: string;
  medianDriftPct: string;
  maxDriftPct: string;
  cardsCompared: number;
};

export type EconomicsPanel = {
  tiers: TierMarginRow[];
  revenue: {
    packPurchase: RevenueProjection;
    marketplacePurchase: RevenueProjection;
    auctionCompletion: RevenueProjection;
    total: RevenueProjection;
  };
  pools: PoolDriftRow[];
};

export type ChiSquaredBucket = {
  rarity: string;
  observed: number;
  expected: number;
  standardisedResidual: string;
  dropped: boolean;
};

export type ChiSquaredResult = {
  tierName: string;
  totalCardsObserved: number;
  degreesOfFreedom: number;
  chiSquared: string;
  pValue: string | null;
  alpha: string;
  decision: "accept" | "reject" | "insufficient_data";
  buckets: ChiSquaredBucket[];
};

export type FairnessPanel = {
  usage: {
    totalConsumedCommits: number;
    totalReveals: number;
    distinctUserPacksVerified: number;
    totalVerifyEvents: number;
    failedVerifyEvents: number;
  };
  chiSquared: {
    perTier: ChiSquaredResult[];
    overallDecision: "accept" | "reject" | "insufficient_data";
    bonferroniAlpha: string;
  };
};

export type UserHealthPanel = {
  dau: number;
  wau: number;
  mau: number;
  dauOverMau: string | null;
  dropParticipationRate: string | null;
  auctionParticipationRate: string | null;
  packToListConversion24h: string | null;
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
};

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

export type HealthAlertRow = {
  id: string;
  alertKey: HealthAlertKey;
  severity: "info" | "warning" | "critical";
  firedAt: string;
  resolvedAt: string | null;
  context: Record<string, unknown>;
};

export type PlatformHealthSummaryResponse = {
  window: PlatformHealthWindow;
  fraud: FraudPanel;
  economics: EconomicsPanel;
  fairness: FairnessPanel;
  users: UserHealthPanel;
  openAlerts: HealthAlertRow[];
  recentAlerts: HealthAlertRow[];
};

export function getPlatformHealthSummary(query: {
  range?: PlatformHealthRangePreset;
  from?: string;
  to?: string;
} = {}): Promise<PlatformHealthSummaryResponse> {
  return apiGetJson<PlatformHealthSummaryResponse>("/analytics/health/summary", {
    range: query.range,
    from: query.from,
    to: query.to
  });
}

export function simulateMarginDrop(payload: {
  tierName: string;
  packs: number;
  marginGapPp: number;
}): Promise<{ inserted: number; alertsTriggered: number }> {
  return apiPostJson<{ inserted: number; alertsTriggered: number }>(
    "/analytics/health/economics/simulate-margin-drop",
    payload
  );
}

export function getPublicUserProfiles(userIds: string[]): Promise<PublicUserProfile[]> {
  const ids = Array.from(new Set(userIds.map((id) => id.trim()).filter(Boolean)));
  return apiGetJson<PublicUserProfile[]>("/users/public/profiles", {
    ids: ids.length > 0 ? ids.join(",") : undefined
  });
}

export function depositWalletFunds(userId: string, amount: string): Promise<DepositFundsResponse> {
  return apiPostJson<DepositFundsResponse>(`/users/${userId}/wallet/deposit`, { amount });
}

export function createPortfolioSnapshot(userId: string): Promise<PortfolioSnapshotCreateResponse> {
  return apiPostJson<PortfolioSnapshotCreateResponse>(`/users/${userId}/portfolio/snapshot`, {});
}

export function unlistUserCard(userId: string, userCardId: string): Promise<UnlistCardResponse> {
  return apiPostJson<UnlistCardResponse>(`/users/${userId}/cards/${userCardId}/unlist`, {});
}

function eventTypesToQueryValue(eventTypes?: EarningsEventType[]): string | undefined {
  if (!eventTypes || eventTypes.length === 0) {
    return undefined;
  }
  return eventTypes.join(",");
}

export function getEarningsOverview(query: EarningsOverviewQuery = {}): Promise<EarningsOverviewResponse> {
  return apiGetJson<EarningsOverviewResponse>("/analytics/earnings/overview", {
    range: query.range,
    from: query.from,
    to: query.to,
    eventTypes: eventTypesToQueryValue(query.eventTypes),
    order: query.order,
    sortBy: query.sortBy
  });
}

export function getEarningsTimeseries(query: EarningsTimeseriesQuery = {}): Promise<EarningsTimeseriesResponse> {
  return apiGetJson<EarningsTimeseriesResponse>("/analytics/earnings/timeseries", {
    range: query.range,
    from: query.from,
    to: query.to,
    eventTypes: eventTypesToQueryValue(query.eventTypes),
    order: query.order,
    groupBy: query.groupBy
  });
}

export function getEarningsEvents(query: EarningsEventsQuery = {}): Promise<EarningsEventsResponse> {
  return apiGetJson<EarningsEventsResponse>("/analytics/earnings/events", {
    range: query.range,
    from: query.from,
    to: query.to,
    eventTypes: eventTypesToQueryValue(query.eventTypes),
    order: query.order,
    sortBy: query.sortBy,
    limit: query.limit != null ? String(query.limit) : undefined,
    offset: query.offset != null ? String(query.offset) : undefined
  });
}

/** Dashboard presets match earnings (`range`). */
export type AuctionAnalyticsRangePreset = EarningsRangePreset;
export type AuctionAnalyticsGroupBy = "day" | "week" | "month";

export type AuctionAnalyticsSummaryResponse = {
  window: EarningsWindow;
  filters: {
    rangePreset: AuctionAnalyticsRangePreset | null;
    snipeWindowSeconds: number;
  };
  settledAuctions: {
    settledListingTotalCount: number;
    soldCount: number;
    unsoldCount: number;
    listingsWithOpenBidActivityCount: number;
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
    soldWithOpenBidHistoryCount: number;
    soldWhereLastOpenBidInSnipeWindowCount: number;
    openPhaseLastBidSnipeRate: string | null;
  };
  flags: {
    needsFraudReviewCount: number;
    fraudReviewFlagRate: string | null;
  };
  sealedPhase: {
    listingsEnteredSealedPhaseCount: number;
    sealedPhaseRateAmongSettled: string | null;
  };
};

export type AuctionAnalyticsTimeseriesPoint = {
  bucketStart: string;
  settledListingCount: number;
  soldCount: number;
  unsoldCount: number;
  listingsWithOpenBidActivityCount: number;
  needsFraudReviewCount: number;
};

export type AuctionAnalyticsTimeseriesResponse = {
  window: EarningsWindow;
  filters: {
    rangePreset: AuctionAnalyticsRangePreset | null;
    groupBy: AuctionAnalyticsGroupBy;
  };
  points: AuctionAnalyticsTimeseriesPoint[];
};

type AuctionAnalyticsSummaryQuery = {
  range?: AuctionAnalyticsRangePreset;
  from?: string;
  to?: string;
  snipeWindowSeconds?: number;
};

type AuctionAnalyticsTimeseriesQuery = {
  range?: AuctionAnalyticsRangePreset;
  from?: string;
  to?: string;
  groupBy?: AuctionAnalyticsGroupBy;
  order?: EarningsSortOrder;
};

export function getAuctionAnalyticsSummary(
  query: AuctionAnalyticsSummaryQuery = {}
): Promise<AuctionAnalyticsSummaryResponse> {
  return apiGetJson<AuctionAnalyticsSummaryResponse>("/analytics/auctions/summary", {
    range: query.range,
    from: query.from,
    to: query.to,
    snipeWindowSeconds: query.snipeWindowSeconds != null ? String(query.snipeWindowSeconds) : undefined
  });
}

export function getAuctionAnalyticsTimeseries(
  query: AuctionAnalyticsTimeseriesQuery = {}
): Promise<AuctionAnalyticsTimeseriesResponse> {
  return apiGetJson<AuctionAnalyticsTimeseriesResponse>("/analytics/auctions/timeseries", {
    range: query.range,
    from: query.from,
    to: query.to,
    groupBy: query.groupBy,
    order: query.order
  });
}

export function getAuctionSlots(query?: { slotStatus?: AuctionSlotStatus }): Promise<AuctionSlot[]> {
  return apiGetJson<AuctionSlot[]>("/auctions/slots", {
    slotStatus: query?.slotStatus
  });
}

export function getAuctionListings(query?: { slotId?: string, slotStatus?: AuctionSlotStatus }): Promise<AuctionListing[]> {
  return apiGetJson<AuctionListing[]>("/auctions/listings", {
    slotId: query?.slotId,
    slotStatus: query?.slotStatus
  });
}

export function addAuctionSlotListing(
  slotId: string,
  body: { userCardId: string; startBidUsd: string; reservePriceUsd?: string }
): Promise<AddAuctionSlotListingResponse> {
  return apiPostJson<AddAuctionSlotListingResponse>(`/auctions/slots/${slotId}/listings`, body);
}

export function startAuction(auctionSlotId: string): Promise<StartAuctionResponse> {
  return apiPostJson<StartAuctionResponse>(`/auctions/slots/${auctionSlotId}/start`, {});
}

export function initAuctionBidSession(auctionId: string): Promise<AuctionBidInitResponse> {
  return apiPostJson<AuctionBidInitResponse>(`/auctions/${auctionId}/bids/init`, {});
}

export function restoreAuctionOutbidWallet(auctionId: string, amountUsd: string): Promise<{ auctionListingId: string; walletBalanceUsd: string }> {
  return apiPostJson<{ auctionListingId: string; walletBalanceUsd: string }>(`/auctions/${auctionId}/bids/restore`, {
    amountUsd
  });
}

export function placeAuctionBid(
  auctionId: string,
  payload: { biddingPriceUsd: string }
): Promise<PlaceAuctionBidResponse> {
  return apiPostJson<PlaceAuctionBidResponse>(`/auctions/${auctionId}/bids`, payload);
}

export function placeAuctionSealedBid(
  auctionId: string,
  payload: { biddingPriceUsd: string }
): Promise<PlaceSealedAuctionBidResponse> {
  return apiPostJson<PlaceSealedAuctionBidResponse>(`/auctions/${auctionId}/bids/sealed`, payload);
}

export function evaluateAuctionFraudReview(auctionId: string): Promise<AuctionFraudReviewResponse> {
  return apiPostJson<AuctionFraudReviewResponse>(`/auctions/${auctionId}/fraud-review`, {});
}
