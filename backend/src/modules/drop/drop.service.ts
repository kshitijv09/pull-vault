import Decimal from "decimal.js";
import { AppError } from "../../shared/errors/AppError";
import { UserRepository } from "../user/user.repository";
import { DropRepository } from "./drop.repository";
import { ShardedRedisPackCounter } from "../../infra/redis/shardedRedisPackCounter";
import { prefetchPackInventoryCaps } from "../pack-queue/packInventoryCapStore";
import { 
  CreateDropInput, DropWithPacks, Drop, 
  AvailablePackForUser, PackDropPhase,
  PackDropPurchaseRequest, PackDropPurchaseResult, PackDropSummary, NextDropState
} from "./drop.types";

export class DropService {
  constructor(
    private readonly repository: DropRepository,
    private readonly userRepository: UserRepository,
    private readonly packCounter: ShardedRedisPackCounter
  ) {}

  async createDrop(input: CreateDropInput): Promise<Drop> {
    const durationMinutes = input.durationMinutes ?? 10;
    if (!input.name || input.name.trim().length === 0) {
      throw new AppError("Drop name is required.", 400);
    }
    if (!input.startTime || Number.isNaN(Date.parse(input.startTime))) {
      throw new AppError("Valid drop startTime is required.", 400);
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      throw new AppError("durationMinutes must be greater than zero.", 400);
    }
    if (!Array.isArray(input.tiers) || input.tiers.length === 0) {
      throw new AppError("At least one tier is required.", 400);
    }
    for (const tier of input.tiers) {
      if (!tier.tierName || tier.tierName.trim().length === 0) {
        throw new AppError("Tier name is required for each tier.", 400);
      }
      if (!Number.isFinite(tier.packCount) || tier.packCount < 0) {
        throw new AppError("Tier packCount must be zero or greater.", 400);
      }
    }
    return this.repository.create({
      ...input,
      durationMinutes
    });
  }

  async listDropsWithPacks(): Promise<DropWithPacks[]> {
    return this.repository.findAllWithPacks();
  }

  async listAvailablePacksForUser(userId: string): Promise<AvailablePackForUser[]> {
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) {
      throw new AppError("User id is required.", 400);
    }

    const user = await this.userRepository.getById(trimmedUserId);
    const balance = new Decimal(user.balance);
    const packs = await this.repository.findAllPacksOrdered();
    const now = Date.now();

    return packs.map((pack) => {
      const dropPhase = this.resolveDropPhase(pack, now);
      const price = new Decimal(pack.priceUsd);
      const userCanAfford = pack.availableCount > 0 && balance.greaterThanOrEqualTo(price);

      return {
        ...pack,
        dropPhase,
        userCanAfford
      };
    });
  }

  async listScheduledDrops(): Promise<PackDropSummary[]> {
    return this.repository.listScheduledDrops();
  }

  async purchasePack(input: PackDropPurchaseRequest): Promise<PackDropPurchaseResult> {
    await this.repository.createPurchase(input);
    return {
      purchaseId: "todo",
      status: "accepted"
    };
  }

  async seedLiveDropCounters(dropId: string): Promise<{ dropId: string; seeded: boolean }> {
    const id = dropId.trim();
    if (!id) {
      throw new AppError("Drop id is required.", 400);
    }
    if (!this.packCounter.isConfigured()) {
      throw new AppError("Redis shard URLs are not configured.", 503);
    }
    const drop = await this.repository.findDropById(id);
    if (!drop) {
      throw new AppError("Drop not found.", 404);
    }
    if (drop.status.toLowerCase() === "completed" || drop.status.toLowerCase() === "ended") {
      throw new AppError("Drop is already completed.", 400);
    }
    if (drop.status.toLowerCase() !== "live") {
      await this.repository.updateDropStatus(id, "live");
    }

    const seed = await this.repository.getTierSeedDataForDrop(id);
    await this.packCounter.seedPackRemaining(seed.rows, seed.tierQueues);
    await prefetchPackInventoryCaps(); // fetch and store count pack-wise count
    return { dropId: id, seeded: true };
  }

  async getNextDropState(): Promise<NextDropState | null> {
    const drop = await this.repository.findNextNonCompletedDrop();
    if (!drop) {
      return null;
    }
    const startsAtMs = Date.parse(drop.startTime);
    const nowMs = Date.now();
    const isLive =
      Number.isFinite(startsAtMs) &&
      startsAtMs <= nowMs &&
      drop.status.toLowerCase() !== "upcoming";

    return {
      id: drop.id,
      name: drop.name,
      startTime: drop.startTime,
      status: drop.status,
      isLive,
      countdownMs: Number.isFinite(startsAtMs) ? Math.max(0, startsAtMs - nowMs) : 0
    };
  }

  async endDropSale(dropId: string): Promise<{ dropId: string; ended: boolean }> {
    const id = dropId.trim();
    if (!id) {
      throw new AppError("Drop id is required.", 400);
    }
    const drop = await this.repository.findDropById(id);
    if (!drop) {
      throw new AppError("Drop not found.", 404);
    }
    if (drop.status.toLowerCase() === "ended") {
      return { dropId: id, ended: true };
    }
    await this.repository.updateDropStatus(id, "ended");
    return { dropId: id, ended: true };
  }

  async processDueDropTransitions(nowIso: string = new Date().toISOString()): Promise<{
    startedDropIds: string[];
    endedDropIds: string[];
  }> {
    const startedDropIds: string[] = [];
    const endedDropIds: string[] = [];

    const dueStarts = await this.repository.findDropsReadyToStart(nowIso);
    for (const dropId of dueStarts) {
      try {
        await this.seedLiveDropCounters(dropId);
        startedDropIds.push(dropId);
      } catch (error) {
        console.error(`[dropLifecycle] failed to start drop ${dropId}`, error);
      }
    }

    const dueEnds = await this.repository.findDropsReadyToEnd(nowIso);
    for (const dropId of dueEnds) {
      try {
        await this.endDropSale(dropId);
        endedDropIds.push(dropId);
      } catch (error) {
        console.error(`[dropLifecycle] failed to end drop ${dropId}`, error);
      }
    }

    return { startedDropIds, endedDropIds };
  }

  private resolveDropPhase(pack: { availableCount: number; dropStartsAt: string }, nowMs: number): PackDropPhase {
    if (pack.availableCount <= 0) {
      return "sold_out";
    }
    if (nowMs < Date.parse(pack.dropStartsAt)) {
      return "upcoming";
    }
    return "live";
  }
}
