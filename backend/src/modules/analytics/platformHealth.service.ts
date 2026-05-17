import Decimal from "decimal.js";
import { AppError } from "../../shared/errors/AppError";
import { AuctionAnalyticsRepository } from "./auctionAnalytics.repository";
import { chiSquaredGoodnessOfFit } from "./chiSquared";
import { logPlatformHealthError } from "./platformHealth.log";
import { packGeneratorConfig } from "../pack-generator/packGenerator.config";
import {
  PlatformHealthRepository,
  type WindowFilter
} from "./platformHealth.repository";
import type {
  ChiSquaredResult,
  EconomicsPanel,
  FairnessPanel,
  FraudPanel,
  HealthAlertKey,
  HealthAlertRow,
  HealthAlertSeverity,
  PlatformHealthRangePreset,
  PlatformHealthSummaryResponse,
  PlatformHealthWindow,
  RateLimitBlockScope,
  RevenueProjection,
  TierMarginRow,
  UserHealthPanel
} from "./platformHealth.types";

/**
 * Alert thresholds.
 *
 * These mirror the table in `architecture/platform-health-dashboard.md`.
 * Operators tune them in env-overrides eventually; for the MVP they're
 * hard-coded so the values that fire alerts and the values shown on the
 * dashboard never drift.
 */
const ALERT_THRESHOLDS = {
  // Fraud panel
  rateLimitBlocksPerMin: { warning: 60, critical: 200 },
  singleIpBlocksPerHour: { critical: 50 },
  auctionFraudFlagRate1h: { warning: 0.02, critical: 0.05 },
  // Economics panel
  tierMarginGapPp: { critical: -0.05 }, // 5pp below target ⇒ critical
  tierWinRatePp: { critical: 0.05 }, // 5pp above ceiling ⇒ critical
  revenueDrop24h: { warning: -0.5 },
  poolMedianDriftPct: { warning: 5, critical: 10 },
  // Fairness
  verifierFailRate1h: { critical: 0.05 },
  poolSnapshotStaleDays: { warning: 30 }
} as const;

/** Bonferroni baseline alpha for tier-level rarity tests. */
const FAIRNESS_BASE_ALPHA = 0.01;

/** Dashboard slot caches (in-memory). Keeps a single hot panel snapshot per range. */
type CachedSlot<T> = { value: T; expiresAt: number } | null;
const CACHE_TTL_MS: Record<"fraud" | "economics" | "fairness" | "users", number> = {
  fraud: 5_000,
  economics: 60_000,
  fairness: 300_000,
  users: 60_000
};

export class PlatformHealthService {
  private fraudCache: Map<string, CachedSlot<FraudPanel>> = new Map();
  private economicsCache: Map<string, CachedSlot<EconomicsPanel>> = new Map();
  private fairnessCache: Map<string, CachedSlot<FairnessPanel>> = new Map();
  private usersCache: Map<string, CachedSlot<UserHealthPanel>> = new Map();

  constructor(
    private readonly repo: PlatformHealthRepository,
    private readonly auctionRepo: AuctionAnalyticsRepository
  ) {}

  async getSummary(input: {
    from?: string;
    to?: string;
    range?: PlatformHealthRangePreset;
  }): Promise<PlatformHealthSummaryResponse> {
    const window = this.resolveWindow(input);
    const filter: WindowFilter = {
      fromIso: window.fromIso ?? undefined,
      toIso: window.toIso ?? undefined
    };

    const [fraud, economics, fairness, users] = await Promise.all([
      this.withPanelLog("fraud", window, () => this.getFraudPanelCached(filter, window)),
      this.withPanelLog("economics", window, () => this.getEconomicsPanelCached(filter, window)),
      this.withPanelLog("fairness", window, () => this.getFairnessPanelCached(filter, window)),
      this.withPanelLog("users", window, () => this.getUserHealthPanelCached(filter, window))
    ]);

    await this.evaluateAlerts({ fraud, economics, fairness, users, window });

    const [openAlerts, recentAlerts] = await Promise.all([
      this.repo.listOpenAlerts(),
      this.repo.listRecentAlerts(50)
    ]);

    return { window, fraud, economics, fairness, users, openAlerts, recentAlerts };
  }

  async listOpenAlerts(): Promise<HealthAlertRow[]> {
    return this.repo.listOpenAlerts();
  }

  async logVerifyEvent(input: {
    userPackId: string;
    verifierUserId: string | null;
    verifierIp: string | null;
    result: "pass" | "fail";
    failingCheck: string | null;
  }): Promise<void> {
    if (input.result === "fail" && !input.failingCheck) {
      throw new AppError("failingCheck is required when result is 'fail'.", 400);
    }
    if (input.result === "pass" && input.failingCheck) {
      throw new AppError("failingCheck must be null when result is 'pass'.", 400);
    }
    await this.repo.insertVerifyEvent(input);
  }

  async simulateMarginDrop(input: {
    tierName: string;
    packs: number;
    marginGapPp: number;
  }): Promise<{ inserted: number; alertsTriggered: number }> {
    if (input.packs <= 0 || input.packs > 100) {
      throw new AppError("packs must be between 1 and 100.", 400);
    }
    if (input.marginGapPp <= -1 || input.marginGapPp >= 1) {
      throw new AppError("marginGapPp must be in (-1, 1).", 400);
    }
    const tier = packGeneratorConfig.tierConfig[input.tierName];
    if (!tier) {
      throw new AppError(`Unknown tier '${input.tierName}'.`, 400);
    }
    // Synthesise pack_purchase rows so the next economics calc sees a worse
    // margin (gap is encoded by lowering retail-side revenue).
    const targetMargin = new Decimal(1).minus(packGeneratorConfig.targetPackValueRatio);
    const effectiveMargin = targetMargin.plus(input.marginGapPp);
    const realisedRatio = new Decimal(1).minus(effectiveMargin);
    const perPackRetail = new Decimal(tier.retailPriceUsd);
    const perPackHouseTake = perPackRetail.minus(perPackRetail.times(realisedRatio));
    const rows = Array.from({ length: input.packs }, () => ({
      amountUsd: perPackHouseTake.toFixed(2),
      tierName: input.tierName
    }));
    const inserted = await this.repo.injectSyntheticPackPurchaseEarnings(rows);
    return { inserted, alertsTriggered: 0 };
  }

  /* ── Panel builders ─────────────────────────────────────────────────── */

  private async getFraudPanelCached(
    filter: WindowFilter,
    window: PlatformHealthWindow
  ): Promise<FraudPanel> {
    const key = cacheKey(window);
    const hit = this.fraudCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await this.buildFraudPanel(filter);
    this.fraudCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS.fraud });
    return value;
  }

  private async buildFraudPanel(filter: WindowFilter): Promise<FraudPanel> {
    const [totalBlocks, scopeBreakdown, topBlockedIps, acceptedPurchases, auctionRollup] =
      await Promise.all([
        this.withRepoLog("fraud", "countBlocks", () => this.repo.countBlocks(filter)),
        this.withRepoLog("fraud", "listScopeBreakdown", () =>
          this.repo.listScopeBreakdown(filter)
        ),
        this.withRepoLog("fraud", "listTopBlockedIps", () =>
          this.repo.listTopBlockedIps(filter, 5)
        ),
        this.withRepoLog("fraud", "countDistinctActiveUsersSince", () =>
          this.repo.countDistinctActiveUsersSince(filter.fromIso ?? "1970-01-01")
        ),
        this.withRepoLog("fraud", "auctionAnalytics.getSettledRollup", () =>
          this.auctionRepo.getSettledRollup({
            fromIso: filter.fromIso,
            toIso: filter.toIso
          })
        )
      ]);

    const attempts = totalBlocks + acceptedPurchases;
    const blockShareOfAttempts =
      attempts > 0 ? new Decimal(totalBlocks).div(attempts).toFixed(4) : null;

    return {
      rateLimit: {
        totalBlocks,
        totalAcceptedPurchases: acceptedPurchases,
        blockShareOfAttempts,
        byScope: scopeBreakdown.map((row) => ({ scope: row.scope, count: row.count }))
      },
      topBlockedIps: topBlockedIps.map((row) => ({
        clientIp: row.clientIp,
        blocks: row.blocks,
        shareOfTotal: totalBlocks > 0 ? new Decimal(row.blocks).div(totalBlocks).toFixed(4) : "0.0000"
      })),
      auctionFraud: {
        settledCount: auctionRollup.settledTotal,
        needsFraudReviewCount: auctionRollup.needsFraudReviewCount,
        flagRate:
          auctionRollup.settledTotal > 0
            ? new Decimal(auctionRollup.needsFraudReviewCount)
                .div(auctionRollup.settledTotal)
                .toFixed(4)
            : null,
        sealedPhaseRate:
          auctionRollup.settledTotal > 0
            ? new Decimal(auctionRollup.sealedPhaseCount)
                .div(auctionRollup.settledTotal)
                .toFixed(4)
            : null
      }
    };
  }

  private async getEconomicsPanelCached(
    filter: WindowFilter,
    window: PlatformHealthWindow
  ): Promise<EconomicsPanel> {
    const key = cacheKey(window);
    const hit = this.economicsCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await this.buildEconomicsPanel(filter);
    this.economicsCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS.economics });
    return value;
  }

  private async buildEconomicsPanel(filter: WindowFilter): Promise<EconomicsPanel> {
    const [tierRollups, revenueByType, pools] = await Promise.all([
      this.repo.getTierMarginRollups(filter),
      this.repo.getRevenueByEventType(filter),
      this.repo.getPoolDrifts()
    ]);

    const targetMargin = new Decimal(1).minus(packGeneratorConfig.targetPackValueRatio);

    const tiers: TierMarginRow[] = tierRollups.map((row) => {
      const retail = new Decimal(row.retailRevenueUsd);
      const realised = new Decimal(row.realisedValueUsd);
      const actualMargin = retail.greaterThan(0)
        ? new Decimal(1).minus(realised.div(retail)).toFixed(4)
        : null;
      const winRate =
        row.packsOpened > 0 ? new Decimal(row.winningPacks).div(row.packsOpened).toFixed(4) : null;
      return {
        tierName: row.tierName,
        packsOpened: row.packsOpened,
        retailRevenueUsd: row.retailRevenueUsd,
        realisedValueUsd: row.realisedValueUsd,
        actualMargin,
        targetMargin: targetMargin.toFixed(4),
        marginGapPp:
          actualMargin !== null
            ? new Decimal(actualMargin).minus(targetMargin).toFixed(4)
            : null,
        winRate
      };
    });

    const revenue = {
      packPurchase: await this.projectRevenue("pack_purchase"),
      marketplacePurchase: await this.projectRevenue("marketplace_purchase"),
      auctionCompletion: await this.projectRevenue("auction_completion"),
      total: aggregateProjection(revenueByType)
    };

    return { tiers, revenue, pools };
  }

  private async projectRevenue(eventType: string): Promise<RevenueProjection> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [total24h, total7d] = await Promise.all([
      this.repo.getRevenueSince(since24h, eventType),
      this.repo.getRevenueSince(since7d, eventType)
    ]);
    return {
      totalRevenueUsd: total7d,
      projectedNext24hUsd: total24h,
      projectedNext7dUsd: new Decimal(total24h).times(7).toFixed(2)
    };
  }

  private async getFairnessPanelCached(
    filter: WindowFilter,
    window: PlatformHealthWindow
  ): Promise<FairnessPanel> {
    const key = cacheKey(window);
    const hit = this.fairnessCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await this.buildFairnessPanel(filter);
    this.fairnessCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS.fairness });
    return value;
  }

  private async buildFairnessPanel(filter: WindowFilter): Promise<FairnessPanel> {
    const [observed, advertised, usage] = await Promise.all([
      this.repo.listObservedRarityCountsForFairnessDrops(filter),
      this.repo.listAdvertisedWeights(),
      this.repo.getFairnessUsage(filter)
    ]);

    const observedByTier = new Map<string, Record<string, number>>();
    for (const row of observed) {
      const bucket = observedByTier.get(row.tierName) ?? {};
      bucket[row.rarity] = (bucket[row.rarity] ?? 0) + row.observed;
      observedByTier.set(row.tierName, bucket);
    }

    const tierNames = Array.from(
      new Set([
        ...observedByTier.keys(),
        ...advertised.map((w) => w.tierName)
      ])
    ).sort();
    const numTests = Math.max(1, tierNames.length);
    const alpha = FAIRNESS_BASE_ALPHA / numTests; // Bonferroni

    const perTier: ChiSquaredResult[] = tierNames.map((tierName) => {
      const advertisedRow = advertised.find((w) => w.tierName === tierName);
      const weights = normaliseWeights(advertisedRow?.rarityWeights ?? {});
      const obs = observedByTier.get(tierName) ?? {};
      const out = chiSquaredGoodnessOfFit({ observed: obs, weights }, alpha);
      return {
        tierName,
        totalCardsObserved: out.totalObserved,
        degreesOfFreedom: out.degreesOfFreedom,
        chiSquared: new Decimal(out.chiSquared).toFixed(4),
        pValue: out.pValue !== null ? new Decimal(out.pValue).toFixed(6) : null,
        alpha: new Decimal(alpha).toFixed(6),
        decision: out.decision,
        buckets: out.buckets.map((b) => ({
          rarity: b.key,
          observed: b.observed,
          expected: b.expected,
          standardisedResidual: new Decimal(b.standardisedResidual).toFixed(4),
          dropped: b.dropped
        }))
      };
    });

    const overallDecision: "accept" | "reject" | "insufficient_data" = perTier.some(
      (t) => t.decision === "reject"
    )
      ? "reject"
      : perTier.every((t) => t.decision === "insufficient_data")
        ? "insufficient_data"
        : "accept";

    return {
      usage: {
        totalConsumedCommits: usage.totalConsumedCommits,
        totalReveals: usage.totalReveals,
        distinctUserPacksVerified: usage.distinctUserPacksVerified,
        totalVerifyEvents: usage.totalVerifyEvents,
        failedVerifyEvents: usage.failedVerifyEvents
      },
      chiSquared: {
        perTier,
        overallDecision,
        bonferroniAlpha: new Decimal(alpha).toFixed(6)
      }
    };
  }

  private async getUserHealthPanelCached(
    filter: WindowFilter,
    window: PlatformHealthWindow
  ): Promise<UserHealthPanel> {
    const key = cacheKey(window);
    const hit = this.usersCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await this.buildUserHealthPanel(filter);
    this.usersCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS.users });
    return value;
  }

  private async buildUserHealthPanel(filter: WindowFilter): Promise<UserHealthPanel> {
    const now = Date.now();
    const since1d = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [dau, wau, mau, dropParticipation, auctionParticipation, packToList, cohort] =
      await Promise.all([
        this.repo.countDistinctActiveUsersSince(since1d),
        this.repo.countDistinctActiveUsersSince(since7d),
        this.repo.countDistinctActiveUsersSince(since30d),
        this.repo.getDropParticipation(filter),
        this.repo.getAuctionParticipation(filter),
        this.repo.getPackToListConversion24h(),
        this.repo.getLatestRetentionCohort()
      ]);

    const dauOverMau = mau > 0 ? new Decimal(dau).div(mau).toFixed(4) : null;
    const dropParticipationRate =
      dropParticipation.activeDuringDrops > 0
        ? new Decimal(dropParticipation.distinctBuyers)
            .div(dropParticipation.activeDuringDrops)
            .toFixed(4)
        : null;
    const auctionParticipationRate =
      auctionParticipation.settled > 0
        ? new Decimal(auctionParticipation.withOpenBids)
            .div(auctionParticipation.settled)
            .toFixed(4)
        : null;
    const packToListConversion24h =
      packToList.pulled > 0
        ? new Decimal(packToList.listed).div(packToList.pulled).toFixed(4)
        : null;

    const retention = {
      cohortStart: cohort?.cohortStart ?? null,
      d1:
        cohort && cohort.cohortSize > 0
          ? new Decimal(cohort.d1Active).div(cohort.cohortSize).toFixed(4)
          : null,
      d7:
        cohort && cohort.cohortSize > 0
          ? new Decimal(cohort.d7Active).div(cohort.cohortSize).toFixed(4)
          : null,
      d30:
        cohort && cohort.cohortSize > 0
          ? new Decimal(cohort.d30Active).div(cohort.cohortSize).toFixed(4)
          : null
    };

    const badgeBreakdown = [
      classifySignal("DAU/MAU", dauOverMau, { yellow: 0.1, red: 0.05 }),
      classifySignal("Drop participation", dropParticipationRate, { yellow: 0.4, red: 0.2 }),
      classifySignal("Pack→List 24h", packToListConversion24h, { yellow: 0.35, red: 0.5 }, true),
      classifySignal("D7 retention", retention.d7, { yellow: 0.2, red: 0.1 })
    ];
    const badge: "green" | "yellow" | "red" = badgeBreakdown.some((b) => b.status === "red")
      ? "red"
      : badgeBreakdown.some((b) => b.status === "yellow")
        ? "yellow"
        : "green";

    return {
      dau,
      wau,
      mau,
      dauOverMau,
      dropParticipationRate,
      auctionParticipationRate,
      packToListConversion24h,
      retention,
      badge,
      badgeBreakdown
    };
  }

  /* ── Alert evaluator ────────────────────────────────────────────────── */

  private async evaluateAlerts(panels: {
    fraud: FraudPanel;
    economics: EconomicsPanel;
    fairness: FairnessPanel;
    users: UserHealthPanel;
    window: PlatformHealthWindow;
  }): Promise<void> {
    const bucket = currentMinuteBucket();
    const fires: Array<{
      alertKey: HealthAlertKey;
      severity: HealthAlertSeverity;
      context: Record<string, unknown>;
    }> = [];

    // Fraud — rate limit pressure. Thresholds in `ALERT_THRESHOLDS` are stated
    // "per minute" in the design doc; we normalise the panel's window-relative
    // count back to a per-minute rate before comparing, so the same alert keys
    // fire consistently whether the operator picked 24h or 30d.
    const totalBlocks = panels.fraud.rateLimit.totalBlocks;
    const windowMinutes = Math.max(1, windowDurationMinutes(panels.window));
    const blocksPerMin = totalBlocks / windowMinutes;
    if (blocksPerMin >= ALERT_THRESHOLDS.rateLimitBlocksPerMin.critical) {
      fires.push({
        alertKey: "rate_limit_pressure",
        severity: "critical",
        context: {
          blocksPerMin,
          totalBlocks,
          windowMinutes,
          threshold: ALERT_THRESHOLDS.rateLimitBlocksPerMin.critical
        }
      });
    } else if (blocksPerMin >= ALERT_THRESHOLDS.rateLimitBlocksPerMin.warning) {
      fires.push({
        alertKey: "rate_limit_pressure",
        severity: "warning",
        context: {
          blocksPerMin,
          totalBlocks,
          windowMinutes,
          threshold: ALERT_THRESHOLDS.rateLimitBlocksPerMin.warning
        }
      });
    }

    // Fraud — single IP spike
    const topIp = panels.fraud.topBlockedIps[0];
    if (topIp && topIp.blocks >= ALERT_THRESHOLDS.singleIpBlocksPerHour.critical) {
      fires.push({
        alertKey: "single_ip_spike",
        severity: "critical",
        context: { clientIp: topIp.clientIp, blocks: topIp.blocks }
      });
    }

    // Fraud — auction flag spike
    if (panels.fraud.auctionFraud.flagRate) {
      const rate = Number(panels.fraud.auctionFraud.flagRate);
      if (rate >= ALERT_THRESHOLDS.auctionFraudFlagRate1h.critical) {
        fires.push({
          alertKey: "auction_fraud_flag_spike",
          severity: "critical",
          context: { rate, threshold: ALERT_THRESHOLDS.auctionFraudFlagRate1h.critical }
        });
      } else if (rate >= ALERT_THRESHOLDS.auctionFraudFlagRate1h.warning) {
        fires.push({
          alertKey: "auction_fraud_flag_spike",
          severity: "warning",
          context: { rate, threshold: ALERT_THRESHOLDS.auctionFraudFlagRate1h.warning }
        });
      }
    }

    // Economics — tier margin breach
    for (const tier of panels.economics.tiers) {
      if (!tier.marginGapPp) continue;
      const gap = Number(tier.marginGapPp);
      if (gap <= ALERT_THRESHOLDS.tierMarginGapPp.critical) {
        fires.push({
          alertKey: "tier_margin_breach",
          severity: "critical",
          context: { tierName: tier.tierName, marginGapPp: gap }
        });
      }
      if (tier.winRate) {
        const winRate = Number(tier.winRate);
        const ceiling = packGeneratorConfig.winRateCeiling + ALERT_THRESHOLDS.tierWinRatePp.critical;
        if (winRate >= ceiling) {
          fires.push({
            alertKey: "tier_win_rate_breach",
            severity: "critical",
            context: { tierName: tier.tierName, winRate, ceiling }
          });
        }
      }
    }

    // Economics — pool drift
    for (const pool of panels.economics.pools) {
      const median = Number(pool.medianDriftPct);
      if (median >= ALERT_THRESHOLDS.poolMedianDriftPct.critical) {
        fires.push({
          alertKey: "pool_price_drift",
          severity: "critical",
          context: { dropId: pool.dropId, medianDriftPct: median }
        });
      } else if (median >= ALERT_THRESHOLDS.poolMedianDriftPct.warning) {
        fires.push({
          alertKey: "pool_price_drift",
          severity: "warning",
          context: { dropId: pool.dropId, medianDriftPct: median }
        });
      }
    }

    // Fairness — rarity distribution breach (any tier rejected)
    for (const tier of panels.fairness.chiSquared.perTier) {
      if (tier.decision === "reject") {
        fires.push({
          alertKey: "rarity_distribution_breach",
          severity: "critical",
          context: {
            tierName: tier.tierName,
            chiSquared: tier.chiSquared,
            pValue: tier.pValue,
            alpha: tier.alpha
          }
        });
      }
    }

    // Fairness — verifier failure spike
    const verifyTotal = panels.fairness.usage.totalVerifyEvents;
    if (verifyTotal > 0) {
      const failRate = panels.fairness.usage.failedVerifyEvents / verifyTotal;
      if (failRate >= ALERT_THRESHOLDS.verifierFailRate1h.critical) {
        fires.push({
          alertKey: "verifier_failures",
          severity: "critical",
          context: { failed: panels.fairness.usage.failedVerifyEvents, total: verifyTotal }
        });
      }
    }

    // Persist (idempotent within the same minute bucket per alert key)
    await Promise.all(
      fires.map((fire) =>
        this.repo.insertAlertIdempotent({
          alertKey: fire.alertKey,
          severity: fire.severity,
          dedupBucket: `${fire.alertKey}:${bucket}`,
          context: fire.context
        })
      )
    );
  }

  /* ── window helper ──────────────────────────────────────────────────── */

  private async withPanelLog<T>(
    panel: string,
    window: PlatformHealthWindow,
    fn: () => Promise<T>
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      logPlatformHealthError(
        {
          operation: "getSummary",
          panel,
          range: window.rangePreset,
          fromIso: window.fromIso,
          toIso: window.toIso
        },
        error
      );
      throw error;
    }
  }

  private async withRepoLog<T>(
    panel: string,
    step: string,
    fn: () => Promise<T>
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      logPlatformHealthError({ operation: "getSummary", panel, step }, error);
      throw error;
    }
  }

  private resolveWindow(input: {
    from?: string;
    to?: string;
    range?: PlatformHealthRangePreset;
  }): PlatformHealthWindow {
    const rangePreset = input.range ?? null;
    const presetWindow = rangePreset ? windowFromPreset(rangePreset) : { fromIso: null, toIso: null };

    const fromIso = input.from ? parseIso(input.from, "from") : presetWindow.fromIso;
    const toIso = input.to ? parseIso(input.to, "to") : presetWindow.toIso;

    if (fromIso && toIso && Date.parse(fromIso) > Date.parse(toIso)) {
      throw new AppError("from must be earlier than or equal to to.", 400);
    }
    return { fromIso, toIso, rangePreset };
  }
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function cacheKey(window: PlatformHealthWindow): string {
  return `${window.fromIso ?? "-"}|${window.toIso ?? "-"}`;
}

function normaliseWeights(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase();
    const num = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(num) && num > 0) {
      out[key] = num;
    }
  }
  return out;
}

function aggregateProjection(
  rows: Array<{ eventType: string; totalUsd: string; events: number }>
): RevenueProjection {
  const total = rows.reduce(
    (acc, r) => acc.plus(r.totalUsd),
    new Decimal(0)
  );
  return {
    totalRevenueUsd: total.toFixed(2),
    projectedNext24hUsd: total.toFixed(2),
    projectedNext7dUsd: total.toFixed(2)
  };
}

function classifySignal(
  signal: string,
  value: string | null,
  thresholds: { yellow: number; red: number },
  invert = false
): { signal: string; status: "green" | "yellow" | "red"; value: string | null } {
  if (value === null) return { signal, status: "yellow", value: null };
  const numeric = Number(value);
  if (invert) {
    if (numeric >= thresholds.red) return { signal, status: "red", value };
    if (numeric >= thresholds.yellow) return { signal, status: "yellow", value };
    return { signal, status: "green", value };
  }
  if (numeric <= thresholds.red) return { signal, status: "red", value };
  if (numeric <= thresholds.yellow) return { signal, status: "yellow", value };
  return { signal, status: "green", value };
}

function parseIso(raw: string, field: "from" | "to"): string {
  const ms = Date.parse(raw.trim());
  if (!Number.isFinite(ms)) {
    throw new AppError(`${field} must be a valid ISO datetime.`, 400);
  }
  return new Date(ms).toISOString();
}

function windowFromPreset(preset: PlatformHealthRangePreset): { fromIso: string | null; toIso: string | null } {
  const now = new Date();
  const toIso = now.toISOString();
  if (preset === "all") return { fromIso: null, toIso: null };
  if (preset === "ytd") {
    const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    return { fromIso: ytdStart.toISOString(), toIso };
  }
  const hours = preset === "24h" ? 24 : preset === "7d" ? 24 * 7 : preset === "30d" ? 24 * 30 : 24 * 90;
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return { fromIso: from.toISOString(), toIso };
}

function currentMinuteBucket(): string {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

/**
 * Window duration in whole minutes, used to normalise per-window counts back
 * to per-minute rates for alert threshold comparisons. Falls back to 60 (1h)
 * for "all"-range or open-ended windows so we don't divide by infinity.
 */
function windowDurationMinutes(window: PlatformHealthWindow): number {
  const FALLBACK_MIN = 60;
  if (!window.fromIso || !window.toIso) return FALLBACK_MIN;
  const from = Date.parse(window.fromIso);
  const to = Date.parse(window.toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return FALLBACK_MIN;
  return Math.max(1, Math.round((to - from) / 60_000));
}
