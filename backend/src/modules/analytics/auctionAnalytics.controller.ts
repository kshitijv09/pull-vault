import type { Request, Response } from "express";
import { AppError } from "../../shared/errors/AppError";
import type { AuctionAnalyticsGroupBy } from "./auctionAnalytics.types";
import { AuctionAnalyticsService } from "./auctionAnalytics.service";
import type { EarningsSortOrder, EarningsTimeRangePreset } from "./earningsAnalytics.types";

const ALLOWED_PRESETS: EarningsTimeRangePreset[] = ["24h", "7d", "30d", "90d", "ytd", "all"];

export class AuctionAnalyticsController {
  constructor(private readonly service: AuctionAnalyticsService) {}

  getSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const snipeWindowSeconds = this.parseSnipeWindowSeconds(req.query.snipeWindowSeconds);
      const result = await this.service.getSummary({
        from: this.optionalString(req.query.from),
        to: this.optionalString(req.query.to),
        range: this.parsePreset(req.query.range),
        snipeWindowSeconds
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
        groupBy: this.parseGroupBy(req.query.groupBy),
        order: this.parseSortOrder(req.query.order)
      });
      res.status(200).json({ data: result });
    } catch (error) {
      this.handleError(error, res);
    }
  };

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

  private parseGroupBy(value: unknown): AuctionAnalyticsGroupBy {
    const raw = this.optionalString(value);
    if (!raw) {
      return "day";
    }
    if (raw !== "day" && raw !== "week" && raw !== "month") {
      throw new AppError("groupBy must be one of: day, week, month.", 400);
    }
    return raw;
  }

  /** Seconds before `end_time` for classifying last open bid as a snipe (anti-snipe window analogue). */
  private parseSnipeWindowSeconds(value: unknown): number {
    const raw = this.optionalString(value);
    if (!raw) {
      return 30;
    }
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 5 || num > 600) {
      throw new AppError("snipeWindowSeconds must be an integer in [5, 600].", 400);
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
