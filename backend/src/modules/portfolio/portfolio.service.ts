import { AppError } from "../../shared/errors/AppError";
import { computeUserPortfolioValueUsd } from "./portfolioValue";
import { PortfolioRepository } from "./portfolio.repository";
import type { PortfolioHistoryRange } from "./portfolio.types";

export class PortfolioService {
  constructor(private readonly repository: PortfolioRepository) {}

  async getCurrentComputation(userId: string) {
    if (!userId.trim()) {
      throw new AppError("User id is required.", 400);
    }
    return computeUserPortfolioValueUsd(userId);
  }

  async recordSnapshotForUser(userId: string) {
    if (!userId.trim()) {
      throw new AppError("User id is required.", 400);
    }
    const computed = await computeUserPortfolioValueUsd(userId);
    const row = await this.repository.insertSnapshot(userId, computed.totalPortfolioValueUsd);
    return { snapshot: row, computation: computed };
  }

  parseRange(raw: unknown): PortfolioHistoryRange {
    const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (s === "1d" || s === "1w" || s === "1m" || s === "ytd") {
      return s;
    }
    throw new AppError("Query ?range= must be one of: 1d, 1w, 1m, ytd.", 400);
  }

  sinceForRange(range: PortfolioHistoryRange, now: Date = new Date()): Date {
    switch (range) {
      case "1d":
        return new Date(now.getTime() - 86_400_000);
      case "1w":
        return new Date(now.getTime() - 7 * 86_400_000);
      case "1m":
        return new Date(now.getTime() - 30 * 86_400_000);
      case "ytd":
        return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    }
  }

  async listSnapshots(userId: string, range: PortfolioHistoryRange) {
    if (!userId.trim()) {
      throw new AppError("User id is required.", 400);
    }
    const since = this.sinceForRange(range);
    return this.repository.listSnapshotsSince(userId, since);
  }

  /** Writes one snapshot row per registered user (typically invoked by the daily scheduler). */
  async recordSnapshotsForAllUsers(): Promise<{ users: number; snapshots: number; failures: number }> {
    const ids = await this.repository.listAllUserIds();
    let snapshots = 0;
    let failures = 0;
    for (const userId of ids) {
      try {
        await this.recordSnapshotForUser(userId);
        snapshots += 1;
      } catch (err) {
        failures += 1;
        console.warn(`[portfolioSnapshot] failed userId=${userId}`, err);
      }
    }
    return { users: ids.length, snapshots, failures };
  }
}
