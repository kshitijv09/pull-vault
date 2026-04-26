import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import { EarningsAnalyticsService } from "./earningsAnalytics.service";
import type { EarningsEventType, EarningsGroupBy, EarningsSortOrder, EarningsTimeRangePreset } from "./earningsAnalytics.types";

const ALLOWED_EVENT_TYPES: EarningsEventType[] = ["marketplace_purchase", "auction_completion", "pack_purchase"];
const ALLOWED_PRESETS: EarningsTimeRangePreset[] = ["24h", "7d", "30d", "90d", "ytd", "all"];

export class EarningsAnalyticsController {
  constructor(private readonly service: EarningsAnalyticsService) {}

  getOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.service.getOverview({
        from: this.optionalString(req.query.from),
        to: this.optionalString(req.query.to),
        range: this.parsePreset(req.query.range),
        eventTypes: this.parseEventTypes(req.query.eventTypes),
        sortBy: this.parseOverviewSortBy(req.query.sortBy),
        order: this.parseSortOrder(req.query.order)
      });
      res.status(200).json({ data: result });
    } catch (error) {
      this.handleError(error, res);
    }
  };

  getTimeseries = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.service.getTimeseries({
        from: this.optionalString(req.query.from),
        to: this.optionalString(req.query.to),
        range: this.parsePreset(req.query.range),
        eventTypes: this.parseEventTypes(req.query.eventTypes),
        groupBy: this.parseGroupBy(req.query.groupBy),
        order: this.parseSortOrder(req.query.order)
      });
      res.status(200).json({ data: result });
    } catch (error) {
      this.handleError(error, res);
    }
  };

  listEvents = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this.service.getEvents({
        from: this.optionalString(req.query.from),
        to: this.optionalString(req.query.to),
        range: this.parsePreset(req.query.range),
        eventTypes: this.parseEventTypes(req.query.eventTypes),
        sortBy: this.parseEventsSortBy(req.query.sortBy),
        order: this.parseSortOrder(req.query.order),
        limit: this.parseNumberInRange(req.query.limit, 1, 200, 50, "limit"),
        offset: this.parseNumberInRange(req.query.offset, 0, 100000, 0, "offset")
      });
      res.status(200).json({ data: result });
    } catch (error) {
      this.handleError(error, res);
    }
  };

  private parseEventTypes(value: unknown): EarningsEventType[] | undefined {
    const raw = this.optionalString(value);
    if (!raw) {
      return undefined;
    }
    const parsed = raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const invalid = parsed.filter((x) => !ALLOWED_EVENT_TYPES.includes(x as EarningsEventType));
    if (invalid.length > 0) {
      throw new AppError(`Invalid eventTypes: ${invalid.join(", ")}.`, 400);
    }
    return [...new Set(parsed)] as EarningsEventType[];
  }

  private parsePreset(value: unknown): EarningsTimeRangePreset | undefined {
    const raw = this.optionalString(value);
    if (!raw) {
      return undefined;
    }
    if (!ALLOWED_PRESETS.includes(raw as EarningsTimeRangePreset)) {
      throw new AppError(`Invalid range preset '${raw}'.`, 400);
    }
    return raw as EarningsTimeRangePreset;
  }

  private parseSortOrder(value: unknown): EarningsSortOrder {
    const raw = this.optionalString(value);
    if (!raw) {
      return "desc";
    }
    if (raw !== "asc" && raw !== "desc") {
      throw new AppError("order must be 'asc' or 'desc'.", 400);
    }
    return raw;
  }

  private parseOverviewSortBy(value: unknown): "amount" | "events" | "average" {
    const raw = this.optionalString(value);
    if (!raw) {
      return "amount";
    }
    if (raw !== "amount" && raw !== "events" && raw !== "average") {
      throw new AppError("sortBy for overview must be 'amount', 'events', or 'average'.", 400);
    }
    return raw;
  }

  private parseGroupBy(value: unknown): EarningsGroupBy {
    const raw = this.optionalString(value);
    if (!raw) {
      return "day";
    }
    if (raw !== "hour" && raw !== "day" && raw !== "week" && raw !== "month") {
      throw new AppError("groupBy must be one of: hour, day, week, month.", 400);
    }
    return raw;
  }

  private parseEventsSortBy(value: unknown): "occurred_at" | "amount_gained_usd" | "event_type" | "created_at" {
    const raw = this.optionalString(value);
    if (!raw) {
      return "occurred_at";
    }
    if (raw !== "occurred_at" && raw !== "amount_gained_usd" && raw !== "event_type" && raw !== "created_at") {
      throw new AppError("sortBy for events must be one of: occurred_at, amount_gained_usd, event_type, created_at.", 400);
    }
    return raw;
  }

  private parseNumberInRange(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
    label: string
  ): number {
    const raw = this.optionalString(value);
    if (!raw) {
      return fallback;
    }
    const num = Number(raw);
    if (!Number.isInteger(num) || num < min || num > max) {
      throw new AppError(`${label} must be an integer in [${min}, ${max}].`, 400);
    }
    return num;
  }

  private optionalString(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private handleError(error: unknown, res: Response): void {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
