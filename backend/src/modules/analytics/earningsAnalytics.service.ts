import { AppError } from "../../shared/errors/AppError";
import { EarningsAnalyticsRepository, type EarningsQueryFilters } from "./earningsAnalytics.repository";
import type {
  EarningsEventType,
  EarningsEventsResponse,
  EarningsGroupBy,
  EarningsOverviewResponse,
  EarningsSortOrder,
  EarningsTimeRangePreset,
  EarningsTimeseriesResponse,
  EarningsWindow
} from "./earningsAnalytics.types";

const ALL_EVENT_TYPES: EarningsEventType[] = ["marketplace_purchase", "auction_completion", "pack_purchase"];

interface WindowInput {
  from?: string;
  to?: string;
  range?: EarningsTimeRangePreset;
  eventTypes?: EarningsEventType[];
}

export class EarningsAnalyticsService {
  constructor(private readonly repository: EarningsAnalyticsRepository) {}

  async getOverview(input: WindowInput & { sortBy: "amount" | "events" | "average"; order: EarningsSortOrder }): Promise<EarningsOverviewResponse> {
    const resolved = this.resolveFilters(input);
    const [summary, sourceBreakdown] = await Promise.all([
      this.repository.getSummary(resolved.filters),
      this.repository.getSourceBreakdown(resolved.filters, input.sortBy, input.order)
    ]);

    return {
      window: resolved.window,
      filters: {
        eventTypes: resolved.eventTypes,
        rangePreset: resolved.rangePreset
      },
      summary,
      sourceBreakdown
    };
  }

  async getTimeseries(
    input: WindowInput & { groupBy: EarningsGroupBy; order: EarningsSortOrder }
  ): Promise<EarningsTimeseriesResponse> {
    const resolved = this.resolveFilters(input);
    const points = await this.repository.getTimeseries(resolved.filters, input.groupBy, input.order);
    return {
      window: resolved.window,
      filters: {
        eventTypes: resolved.eventTypes,
        rangePreset: resolved.rangePreset,
        groupBy: input.groupBy
      },
      points
    };
  }

  async getEvents(
    input: WindowInput & {
      sortBy: "occurred_at" | "amount_gained_usd" | "event_type" | "created_at";
      order: EarningsSortOrder;
      limit: number;
      offset: number;
    }
  ): Promise<EarningsEventsResponse> {
    const resolved = this.resolveFilters(input);
    const events = await this.repository.listEvents(resolved.filters, {
      sortBy: input.sortBy,
      order: input.order,
      limit: input.limit,
      offset: input.offset
    });
    return {
      window: resolved.window,
      filters: {
        eventTypes: resolved.eventTypes,
        rangePreset: resolved.rangePreset
      },
      pagination: {
        limit: input.limit,
        offset: input.offset
      },
      sort: {
        by: input.sortBy,
        order: input.order
      },
      events
    };
  }

  private resolveFilters(input: WindowInput): {
    filters: EarningsQueryFilters;
    eventTypes: EarningsEventType[];
    window: EarningsWindow;
    rangePreset: EarningsTimeRangePreset | null;
  } {
    const eventTypes = input.eventTypes && input.eventTypes.length > 0 ? input.eventTypes : ALL_EVENT_TYPES;
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
        toIso: toIso ?? undefined,
        eventTypes
      },
      eventTypes,
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

  private windowFromPreset(preset: EarningsTimeRangePreset): EarningsWindow {
    const now = new Date();
    const toIso = now.toISOString();
    if (preset === "all") {
      return { fromIso: null, toIso: null };
    }
    if (preset === "ytd") {
      const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      return { fromIso: ytdStart.toISOString(), toIso };
    }

    const hours = preset === "24h" ? 24 : preset === "7d" ? 24 * 7 : preset === "30d" ? 24 * 30 : 24 * 90;
    const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
    return { fromIso: from.toISOString(), toIso };
  }
}
