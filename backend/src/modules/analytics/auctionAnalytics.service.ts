import { AppError } from "../../shared/errors/AppError";
import { AuctionAnalyticsRepository, type AuctionEndedFilters } from "./auctionAnalytics.repository";
import type {
  AuctionAnalyticsSummaryResponse,
  AuctionAnalyticsTimeseriesResponse,
  AuctionAnalyticsWindow,
  AuctionAnalyticsGroupBy
} from "./auctionAnalytics.types";
import type { EarningsSortOrder, EarningsTimeRangePreset } from "./earningsAnalytics.types";

interface WindowInput {
  from?: string;
  to?: string;
  range?: EarningsTimeRangePreset;
}

export class AuctionAnalyticsService {
  constructor(private readonly repository: AuctionAnalyticsRepository) {}

  async getSummary(input: WindowInput & { snipeWindowSeconds: number }): Promise<AuctionAnalyticsSummaryResponse> {
    const resolved = this.resolveFilters(input);
    const filters = resolved.filters;
    const [
      rollup,
      avgDistinctBidders,
      avgOpenBidRows,
      pricing,
      snipe
    ] = await Promise.all([
      this.repository.getSettledRollup(filters),
      this.repository.getAvgDistinctBiddersAmongListingsWithOpenBids(filters),
      this.repository.getAvgOpenBidRowsAmongListingsWithBids(filters),
      this.repository.getPricingVsMarket(filters),
      this.repository.getOpenPhaseSnipeCounts(filters, input.snipeWindowSeconds)
    ]);

    const settled = rollup.settledTotal;
    const participationRate = this.safeRatio(rollup.withOpenBidActivityCount, settled);
    const fraudFlagRate = this.safeRatio(rollup.needsFraudReviewCount, settled);
    const sealedPhaseRate = this.safeRatio(rollup.sealedPhaseCount, settled);
    const snipeRate = this.safeRatio(snipe.soldSniped, snipe.soldWithOpenBids);

    return {
      window: resolved.window,
      filters: {
        rangePreset: resolved.rangePreset,
        snipeWindowSeconds: input.snipeWindowSeconds
      },
      settledAuctions: {
        settledListingTotalCount: settled,
        soldCount: rollup.soldCount,
        unsoldCount: rollup.unsoldCount,
        listingsWithOpenBidActivityCount: rollup.withOpenBidActivityCount,
        participationRateListingsWithOpenBids: participationRate,
        avgDistinctOpenBiddersAmongListingsWithBids: avgDistinctBidders,
        avgOpenBidRowsPerListingWithBids: avgOpenBidRows
      },
      pricingVsMarket: {
        soldListingsWithPositiveMarketCount: pricing.soldWithPositiveMarketCount,
        avgFinalBidToMarketRatio: pricing.avgRatio,
        medianFinalBidToMarketRatio: pricing.medianRatio
      },
      sniping: {
        soldWithOpenBidHistoryCount: snipe.soldWithOpenBids,
        soldWhereLastOpenBidInSnipeWindowCount: snipe.soldSniped,
        openPhaseLastBidSnipeRate: snipeRate
      },
      flags: {
        needsFraudReviewCount: rollup.needsFraudReviewCount,
        fraudReviewFlagRate: fraudFlagRate
      },
      sealedPhase: {
        listingsEnteredSealedPhaseCount: rollup.sealedPhaseCount,
        sealedPhaseRateAmongSettled: sealedPhaseRate
      }
    };
  }

  async getTimeseries(
    input: WindowInput & { groupBy: AuctionAnalyticsGroupBy; order: EarningsSortOrder }
  ): Promise<AuctionAnalyticsTimeseriesResponse> {
    const resolved = this.resolveFilters(input);
    const rows = await this.repository.getTimeseries(resolved.filters, input.groupBy, input.order);
    return {
      window: resolved.window,
      filters: {
        rangePreset: resolved.rangePreset,
        groupBy: input.groupBy
      },
      points: rows.map((row) => ({
        bucketStart: row.bucketStart.toISOString(),
        settledListingCount: Number(row.settledTotal),
        soldCount: Number(row.soldN),
        unsoldCount: Number(row.unsoldN),
        listingsWithOpenBidActivityCount: Number(row.withBidsN),
        needsFraudReviewCount: Number(row.flaggedN)
      }))
    };
  }

  private safeRatio(numerator: number, denominator: number): string | null {
    if (denominator <= 0) {
      return null;
    }
    return (numerator / denominator).toFixed(6);
  }

  private resolveFilters(input: WindowInput): {
    filters: AuctionEndedFilters;
    window: AuctionAnalyticsWindow;
    rangePreset: EarningsTimeRangePreset | null;
  } {
    const rangePreset = input.range ?? null;
    const presetWindow = rangePreset ? this.windowFromPreset(rangePreset) : { fromIso: null, toIso: null };

    const fromIso = input.from ? this.parseIso(input.from, "from") : presetWindow.fromIso;
    const toIso = input.to ? this.parseIso(input.to, "to") : presetWindow.toIso;

    if (fromIso && toIso && Date.parse(fromIso) > Date.parse(toIso)) {
      throw new AppError("from must be earlier than or equal to to.", 400);
    }

    return {
      filters: {
        fromIso: fromIso ?? undefined,
        toIso: toIso ?? undefined
      },
      window: { fromIso, toIso },
      rangePreset
    };
  }

  private parseIso(raw: string, field: "from" | "to"): string {
    const trimmed = raw.trim();
    const ms = Date.parse(trimmed);
    if (!Number.isFinite(ms)) {
      throw new AppError(`${field} must be a valid ISO datetime.`, 400);
    }
    return new Date(ms).toISOString();
  }

  private windowFromPreset(preset: EarningsTimeRangePreset): AuctionAnalyticsWindow {
    const now = new Date();
    const toIso = now.toISOString();
    if (preset === "all") {
      return { fromIso: null, toIso: null };
    }
    if (preset === "ytd") {
      const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      return { fromIso: ytdStart.toISOString(), toIso };
    }

    const hours =
      preset === "24h" ? 24 : preset === "7d" ? 24 * 7 : preset === "30d" ? 24 * 30 : 24 * 90;
    const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
    return { fromIso: from.toISOString(), toIso };
  }
}
