import Decimal from "decimal.js";
import { getClient } from "../../db";
import { AppError } from "../../shared/errors/AppError";
import {
  CATALOG_PRICE_PACK_REGEN_RELATIVE_THRESHOLD,
  packGeneratorConfig,
  PACK_GENERATOR_CARDS_PER_PACK
  // SIMULATION_ONLY_CARD_PRICES_USD — simulate uses DB catalog only
} from "./packGenerator.config";
import { PackGeneratorRepository } from "./packGenerator.repository";
import { PriceSyncService } from "./priceSync.service";
import type {
  CatalogPriceSyncRegenerationResult,
  CreatePackGenerationRequest,
  GeneratePackBatchResult,
  GeneratedPack,
  PackSimulationResult,
  RegeneratePackCardsRequest,
  RegeneratePackCardsResult,
  RegeneratePackCardsResultItem,
  SimulatePackRequest
} from "./packGenerator.types";
import type { PackGenerationStrategy, CandidateCard } from "./strategies/PackGenerationStrategy";
import { StandardGenerationStrategy } from "./strategies/StandardGenerationStrategy";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGENERATE_PACKS_MAX = 100;

export class PackGeneratorService {
  private readonly strategies: Map<string, PackGenerationStrategy> = new Map();

  constructor(
    private readonly repository: PackGeneratorRepository,
    private readonly priceSyncService: PriceSyncService
  ) {
    this.registerStrategy(new StandardGenerationStrategy());
  }

  private registerStrategy(strategy: PackGenerationStrategy): void {
    this.strategies.set(strategy.name.toLowerCase(), strategy);
  }

  async generatePackBatch(body: unknown): Promise<GeneratePackBatchResult> {
    const request = this.parseRequest(body);
    const strategy = this.getStrategy(request.strategyName);

    const tierKey = request.tierName.toLowerCase();
    const tier = packGeneratorConfig.tierConfig[tierKey];
    if (!tier) {
      throw new AppError(
        `Unknown tier_name '${request.tierName}'. Available: ${Object.keys(packGeneratorConfig.tierConfig).join(", ")}.`,
        400
      );
    }

    const candidateCards = await this.repository.findAllCatalogCards();
    if (candidateCards.length === 0) {
      throw new AppError("No catalog cards available for pack generation.", 404);
    }

    const retailPrice = new Decimal(tier.retailPriceUsd);
    const targetPackValue = retailPrice
      .mul(packGeneratorConfig.targetPackValueRatio)
      .toDecimalPlaces(2);

    const candidates: CandidateCard[] = candidateCards.map((card) => ({
      card,
      marketValue: new Decimal(card.marketValueUsd)
    }));

    let dryStreak = request.dryStreakInitial ?? 0;
    const packs: GeneratedPack[] = [];
    for (let i = 0; i < request.count; i += 1) {
      const pack = strategy.generateOnePack(candidates, targetPackValue, i + 1, retailPrice, dryStreak);
      packs.push(pack);
      const total = new Decimal(pack.totalValueUsd);
      dryStreak = total.greaterThanOrEqualTo(retailPrice) ? 0 : dryStreak + 1;
    }
    this.assertEachPackHasExpectedCardCount(packs);
    this.assertBatchVarianceWithinBounds(packs, targetPackValue);
    this.logGeneratedPackPricing(packs, targetPackValue, request.tierName);

    await this.repository.insertGeneratedPackBatch(
      request.tierName,
      tier.retailPriceUsd,
      packs
    );

    return {
      tierName: request.tierName,
      strategyName: request.strategyName,
      count: request.count,
      targetPackValueUsd: this.toMoneyString(targetPackValue),
      generatedAt: new Date().toISOString(),
      packs
    };
  }

  /**
   * Re-runs `StandardGenerationStrategy` for each `packs.id`, deletes existing `pack_card` rows,
   * inserts new links (same transaction per batch). Uses each row’s `price` as retail and
   * `packGeneratorConfig.targetPackValueRatio` for TPV.
   */
  async regeneratePackCardsByIds(body: unknown): Promise<RegeneratePackCardsResult> {
    const request = this.parseRegeneratePackCardsRequest(body);
    return this.regeneratePackCardsByPackIds(request.packIds);
  }

  /**
   * Runs {@link PriceSyncService.syncAllPrices}, then regenerates every eligible `packs` template
   * that contains a card whose catalog price moved beyond {@link CATALOG_PRICE_PACK_REGEN_RELATIVE_THRESHOLD}.
   */
  async syncCatalogPricesAndRegenerateEligiblePacks(): Promise<CatalogPriceSyncRegenerationResult> {
    const significantCardRowIds = await this.priceSyncService.syncAllPrices();
    if (significantCardRowIds.length === 0) {
      return {
        significantPriceChangeCardCount: 0,
        regeneratedPackCount: 0,
        regeneratedPacks: []
      };
    }

    const packTemplateIds = await this.repository.findPackTemplateIdsEligibleForRegeneration(
      significantCardRowIds
    );
    if (packTemplateIds.length === 0) {
      return {
        significantPriceChangeCardCount: significantCardRowIds.length,
        regeneratedPackCount: 0,
        regeneratedPacks: []
      };
    }

    const { packs } = await this.regeneratePackCardsByPackIds(packTemplateIds);
    return {
      significantPriceChangeCardCount: significantCardRowIds.length,
      regeneratedPackCount: packs.length,
      regeneratedPacks: packs
    };
  }

  /**
   * Core implementation for `regeneratePackCardsByIds` and auto-regeneration after price sync.
   * Processes at most {@link REGENERATE_PACKS_MAX} templates per DB transaction to bound lock duration.
   */
  private async regeneratePackCardsByPackIds(packIds: string[]): Promise<RegeneratePackCardsResult> {
    if (packIds.length === 0) {
      return { packs: [] };
    }

    const candidateCards = await this.repository.findAllCatalogCards();
    if (candidateCards.length < PACK_GENERATOR_CARDS_PER_PACK) {
      throw new AppError(
        `Need at least ${PACK_GENERATOR_CARDS_PER_PACK} catalog cards to build a pack; found ${candidateCards.length}.`,
        422
      );
    }
    const candidates: CandidateCard[] = candidateCards.map((card) => ({
      card,
      marketValue: new Decimal(card.marketValueUsd)
    }));

    const strategy = this.getStrategy(packGeneratorConfig.defaultStrategyName);
    const packsOut: RegeneratePackCardsResultItem[] = [];

    for (let offset = 0; offset < packIds.length; offset += REGENERATE_PACKS_MAX) {
      const chunk = packIds.slice(offset, offset + REGENERATE_PACKS_MAX);
      const chunkItems = await this.regeneratePackCardsChunk(chunk, candidates, strategy);
      packsOut.push(...chunkItems);
    }

    return { packs: packsOut };
  }

  private async regeneratePackCardsChunk(
    chunkPackIds: string[],
    candidates: CandidateCard[],
    strategy: PackGenerationStrategy
  ): Promise<RegeneratePackCardsResultItem[]> {
    const rows = await this.repository.findPacksByIds(chunkPackIds);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = chunkPackIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new AppError(`Unknown pack id(s): ${missing.join(", ")}`, 404);
    }

    const orderedRows = chunkPackIds.map((id) => byId.get(id)!);
    const client = await getClient();
    const packsOut: RegeneratePackCardsResultItem[] = [];
    try {
      await client.query("BEGIN");
      for (const packRow of orderedRows) {
        const retailPrice = new Decimal(packRow.priceText).toDecimalPlaces(2);
        const targetPackValue = retailPrice
          .mul(packGeneratorConfig.targetPackValueRatio)
          .toDecimalPlaces(2);
        const gen = strategy.generateOnePack(candidates, targetPackValue, 1, retailPrice, 0);
        if (gen.cards.length !== PACK_GENERATOR_CARDS_PER_PACK) {
          throw new AppError(
            `Pack ${packRow.id}: expected ${PACK_GENERATOR_CARDS_PER_PACK} generated cards, got ${gen.cards.length}.`,
            422
          );
        }
        await this.repository.replacePackCardLinks(
          client,
          packRow.id,
          gen.cards.map((c) => c.id),
          gen.cards.length
        );
        packsOut.push({
          packId: packRow.id,
          tierName: packRow.tierName,
          branch: gen.branch,
          totalValueUsd: gen.totalValueUsd,
          targetPackValueUsd: gen.targetPackValueUsd,
          catalogCardIds: gen.cards.map((c) => c.id),
          tcgExternalCardIds: gen.cards.map((c) => c.cardId)
        });
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return packsOut;
  }

  /**
   * Simulation endpoint logic: generates `count` packs from the DB `card` catalog, computes economics stats.
   * Does NOT persist packs to the database.
   */
  async simulatePacks(body: unknown): Promise<PackSimulationResult> {
    const request = this.parseSimulateRequest(body);
    const strategy = this.getStrategy(packGeneratorConfig.defaultStrategyName);

    const tierKey = request.tierName.toLowerCase();
    const tier = packGeneratorConfig.tierConfig[tierKey];
    if (!tier) {
      throw new AppError(
        `Unknown tier_name '${request.tierName}'. Available: ${Object.keys(packGeneratorConfig.tierConfig).join(", ")}.`,
        400
      );
    }

    const candidateCards = await this.repository.findAllCatalogCards();
    if (candidateCards.length < PACK_GENERATOR_CARDS_PER_PACK) {
      throw new AppError(
        `Need at least ${PACK_GENERATOR_CARDS_PER_PACK} catalog cards in the database for simulation; found ${candidateCards.length}.`,
        404
      );
    }

    const candidates: CandidateCard[] = candidateCards.map((card) => ({
      card,
      marketValue: new Decimal(card.marketValueUsd)
    }));

    const retailPrice = new Decimal(tier.retailPriceUsd);
    const tpv = retailPrice.mul(packGeneratorConfig.targetPackValueRatio).toDecimalPlaces(2);

    let dryStreak = request.dryStreakInitial ?? 0;
    const packs: GeneratedPack[] = [];
    for (let i = 0; i < request.count; i += 1) {
      const pack = strategy.generateOnePack(candidates, tpv, i + 1, retailPrice, dryStreak);
      packs.push(pack);
      const total = new Decimal(pack.totalValueUsd);
      dryStreak = total.greaterThanOrEqualTo(retailPrice) ? 0 : dryStreak + 1;
    }
    this.assertEachPackHasExpectedCardCount(packs);

    return this.computeSimulationStats(packs, retailPrice, tpv, request.tierName, request.count);
  }

  // /** Simulation-only catalog: fixed USD ladder + rarity from `CARD_VALUE_USD_RARITY_BANDS`. */
  // private buildSyntheticSimulationCandidates(pricesUsd: readonly number[]): CandidateCard[] {
  //   return pricesUsd.map((raw, i) => {
  //     const marketValue = new Decimal(raw).toDecimalPlaces(2);
  //     const money = marketValue.toFixed(2);
  //     const { label } = rarityFromMarketValueUsd(marketValue);
  //     const card: CatalogCard = {
  //       id: `sim-${i}`,
  //       cardId: `sim-${i}`,
  //       name: `Sim $${money} (${label})`,
  //       cardSet: "__simulation__",
  //       imageUrl: "",
  //       rarity: label,
  //       marketValueUsd: money
  //     };
  //     return { card, marketValue };
  //   });
  // }

  private computeSimulationStats(
    packs: GeneratedPack[],
    retailPrice: Decimal,
    tpv: Decimal,
    tierName: string,
    count: number
  ): PackSimulationResult {
    const values = packs.map((p) => new Decimal(p.totalValueUsd)).sort((a, b) => a.comparedTo(b));
    const total = values.reduce((s, v) => s.plus(v), new Decimal(0));
    const avgValue = total.div(count);
    const realisedMargin = retailPrice.minus(avgValue).div(retailPrice);

    const winCount = values.filter((v) => v.greaterThanOrEqualTo(retailPrice)).length;
    const winRate = winCount / count;

    const godHitCount = packs.filter((p) => p.branch === "god_hit").length;
    const retailSwingCount = packs.filter((p) => p.branch === "retail_swing").length;
    const expansionCount = packs.filter((p) => p.branch === "expansion").length;
    const branchTotal = godHitCount + retailSwingCount + expansionCount;
    if (branchTotal !== count) {
      throw new Error(
        `Simulation branch counts (${branchTotal}) must equal simulation count (${count}).`
      );
    }

    const lossCount = count - winCount;
    if (winCount + lossCount !== count) {
      throw new Error("Simulation win/loss counts must equal simulation count.");
    }

    const median = this.percentile(values, 0.5);
    const p5 = this.percentile(values, 0.05);
    const p95 = this.percentile(values, 0.95);

    const hist = this.buildDistributionHistogram(values, tpv);

    const aggregateTotalRetail = retailPrice.mul(count);
    const aggregateTotalRealised = total;
    const netProfitLossPctDecimal = aggregateTotalRealised.isZero()
      ? null
      : aggregateTotalRetail.minus(aggregateTotalRealised).div(aggregateTotalRealised).mul(100).toDecimalPlaces(2);

    const marginOk = realisedMargin.greaterThanOrEqualTo(
      new Decimal(packGeneratorConfig.targetPackValueRatio).minus(1).abs().minus(0.02)
    );
    const winRateOk = winRate >= packGeneratorConfig.winRateFloor - 0.03;
    const winRateBelowCeiling = winRate <= packGeneratorConfig.winRateCeiling + 0.03;
    const p5Ok = p5.greaterThan(0);

    return {
      tierName,
      simulationCount: count,
      retailPriceUsd: this.toMoneyString(retailPrice),
      targetPackValueUsd: this.toMoneyString(tpv),
      targetMargin: `${((1 - packGeneratorConfig.targetPackValueRatio) * 100).toFixed(1)}%`,
      winRateFloor: `${(packGeneratorConfig.winRateFloor * 100).toFixed(1)}%`,
      winRateCeiling: `${(packGeneratorConfig.winRateCeiling * 100).toFixed(1)}%`,
      results: {
        avgRealisedValueUsd: this.toMoneyString(avgValue),
        medianRealisedValueUsd: this.toMoneyString(median),
        p5RealisedValueUsd: this.toMoneyString(p5),
        p95RealisedValueUsd: this.toMoneyString(p95),
        realisedMargin: `${realisedMargin.mul(100).toDecimalPlaces(2).toFixed(2)}%`,
        netProfitLossPctOnCardValue:
          netProfitLossPctDecimal === null
            ? "NaN%"
            : `${netProfitLossPctDecimal.greaterThanOrEqualTo(0) ? "+" : ""}${netProfitLossPctDecimal.toFixed(2)}%`,
        aggregateTotalRetailUsd: this.toMoneyString(aggregateTotalRetail),
        aggregateTotalRealisedValueUsd: this.toMoneyString(aggregateTotalRealised),
        winRate: `${(winRate * 100).toFixed(2)}%`,
        winCount,
        lossCount,
        godHitCount,
        retailSwingCount,
        packCounts: {
          byBranch: {
            godHit: godHitCount,
            standard: expansionCount,
            retailSwing: retailSwingCount,
            total: count
          },
          byOutcome: {
            win: winCount,
            loss: lossCount,
            total: count
          }
        },
        distribution: hist
      },
      acceptanceCriteria: {
        marginWithin2ppOfTarget: marginOk,
        winRateAboveFloor: winRateOk,
        winRateBelowCeiling,
        p5AboveZero: p5Ok,
        allPassed: marginOk && winRateOk && winRateBelowCeiling && p5Ok
      },
      packs: packs.map((p) => ({
        sequence: p.sequence,
        branch: p.branch,
        retailPriceUsd: this.toMoneyString(retailPrice),
        targetPackValueUsd: p.targetPackValueUsd,
        realisedValueUsd: p.totalValueUsd,
        diffVsRetailUsd: new Decimal(p.totalValueUsd).minus(retailPrice).toDecimalPlaces(2).toFixed(2),
        diffVsTpvUsd: new Decimal(p.totalValueUsd).minus(tpv).toDecimalPlaces(2).toFixed(2),
        isWin: new Decimal(p.totalValueUsd).greaterThanOrEqualTo(retailPrice),
        cards: p.cards.map((c) => ({
          name: c.name,
          rarity: c.rarity,
          slot: c.slot,
          marketValueUsd: c.marketValueUsd
        }))
      }))
    };
  }

  private percentile(sortedValues: Decimal[], p: number): Decimal {
    if (sortedValues.length === 0) return new Decimal(0);
    const idx = Math.min(Math.floor(p * sortedValues.length), sortedValues.length - 1);
    return sortedValues[idx];
  }

  private buildDistributionHistogram(
    sortedValues: Decimal[],
    tpv: Decimal
  ): PackSimulationResult["results"]["distribution"] {
    const n = sortedValues.length;
    const bands = [
      { label: "lt_50pct_tpv",  min: new Decimal(0),       max: tpv.mul(0.5)  },
      { label: "50_70pct_tpv",  min: tpv.mul(0.5),         max: tpv.mul(0.7)  },
      { label: "70_90pct_tpv",  min: tpv.mul(0.7),         max: tpv.mul(0.9)  },
      { label: "90_100pct_tpv", min: tpv.mul(0.9),         max: tpv            },
      { label: "gt_tpv",        min: tpv,                  max: new Decimal(Infinity) }
    ];
    return bands.map((b) => {
      const cnt = sortedValues.filter(
        (v) => v.greaterThanOrEqualTo(b.min) && v.lessThan(b.max.isFinite() ? b.max : new Decimal("9999999"))
      ).length;
      return { band: b.label, count: cnt, pct: `${((cnt / n) * 100).toFixed(1)}%` };
    });
  }

  private getStrategy(strategyName: string): PackGenerationStrategy {
    const strategy = this.strategies.get(strategyName.toLowerCase());
    if (!strategy) {
      throw new AppError(
        `Unsupported strategy '${strategyName}'. Available: ${Array.from(this.strategies.keys()).join(", ")}`,
        400
      );
    }
    return strategy;
  }

  private parseRequest(body: unknown): CreatePackGenerationRequest {
    if (!body || typeof body !== "object") {
      throw new AppError("Request body must be a JSON object.", 400);
    }
    const record = body as Record<string, unknown>;
    const tierRaw = this.asNonEmptyString(record.tier_name ?? record.tierName, "tier_name");
    const strategyRaw = this.asNonEmptyString(
      record.strategy_name ?? record.strategyName ?? packGeneratorConfig.defaultStrategyName,
      "strategy_name"
    );
    const countRaw = record.count;
    const count = typeof countRaw === "number" ? countRaw : Number(countRaw);
    if (!Number.isInteger(count) || count <= 0 || count > 100) {
      throw new AppError("count must be an integer between 1 and 100.", 400);
    }
    const dryStreakInitial = this.parseOptionalNonNegativeInt(
      record.dry_streak_initial ?? record.dryStreakInitial,
      "dry_streak_initial"
    );
    return { tierName: tierRaw, strategyName: strategyRaw, count, dryStreakInitial };
  }

  private parseRegeneratePackCardsRequest(body: unknown): RegeneratePackCardsRequest {
    if (!body || typeof body !== "object") {
      throw new AppError("Request body must be a JSON object.", 400);
    }
    const record = body as Record<string, unknown>;
    const raw = record.pack_ids ?? record.packIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new AppError("pack_ids must be a non-empty array of UUID strings.", 400);
    }
    if (raw.length > REGENERATE_PACKS_MAX) {
      throw new AppError(`pack_ids must contain at most ${REGENERATE_PACKS_MAX} entries.`, 400);
    }
    const packIds: string[] = [];
    for (const item of raw) {
      const id = typeof item === "string" ? item.trim() : String(item);
      if (!UUID_RE.test(id)) {
        throw new AppError(`Invalid pack UUID: ${String(item)}`, 400);
      }
      packIds.push(id);
    }
    const unique = [...new Set(packIds)];
    if (unique.length !== packIds.length) {
      throw new AppError("pack_ids must not contain duplicates.", 400);
    }
    return { packIds: unique };
  }

  private parseSimulateRequest(body: unknown): SimulatePackRequest {
    if (!body || typeof body !== "object") {
      throw new AppError("Request body must be a JSON object.", 400);
    }
    const record = body as Record<string, unknown>;
    const tierRaw = this.asNonEmptyString(record.tier_name ?? record.tierName, "tier_name");
    const countRaw = record.count ?? record.simulationCount;
    const count = typeof countRaw === "number" ? countRaw : Number(countRaw);
    if (!Number.isInteger(count) || count <= 0 || count > 10000) {
      throw new AppError("count must be an integer between 1 and 10000.", 400);
    }
    const dryStreakInitial = this.parseOptionalNonNegativeInt(
      record.dry_streak_initial ?? record.dryStreakInitial,
      "dry_streak_initial"
    );
    return { tierName: tierRaw, count, dryStreakInitial };
  }

  private parseOptionalNonNegativeInt(raw: unknown, fieldName: string): number | undefined {
    if (raw === undefined || raw === null || raw === "") return undefined;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      throw new AppError(`${fieldName} must be a non-negative integer when provided.`, 400);
    }
    return n;
  }

  private asNonEmptyString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new AppError(`${fieldName} is required.`, 400);
    }
    return value.trim();
  }

  private toMoneyString(value: Decimal): string {
    return value.toDecimalPlaces(2).toFixed(2);
  }

  /** Same `StandardGenerationStrategy` rules as simulate; DB batch must not persist short packs. */
  private assertEachPackHasExpectedCardCount(packs: GeneratedPack[]): void {
    for (const p of packs) {
      if (p.cards.length !== PACK_GENERATOR_CARDS_PER_PACK) {
        throw new AppError(
          `Each pack must contain exactly ${PACK_GENERATOR_CARDS_PER_PACK} cards (sequence ${p.sequence}, branch ${p.branch}, got ${p.cards.length}).`,
          422
        );
      }
    }
  }

  private assertBatchVarianceWithinBounds(packs: GeneratedPack[], targetPackValue: Decimal): void {
    if (packs.length < 100) return;
    const total = packs.reduce((sum, pack) => sum.plus(new Decimal(pack.totalValueUsd)), new Decimal(0));
    const average = total.div(packs.length);
    const minPreferred = targetPackValue.mul(0.96);
    if (average.lessThan(minPreferred) || average.greaterThan(targetPackValue.mul(1.2))) {
      throw new AppError(
        `Generated batch average (${this.toMoneyString(average)}) is outside preferred range for TPV ${this.toMoneyString(targetPackValue)}.`,
        422
      );
    }
  }

  private logGeneratedPackPricing(packs: GeneratedPack[], targetPackValue: Decimal, tierName: string): void {
    for (const pack of packs) {
      const cardPrices = pack.cards.map((card) => `${card.cardId}:${card.marketValueUsd}`).join(", ");
      console.log(
        `[pack-generator] tier=${tierName} seq=${pack.sequence} tpv=${this.toMoneyString(targetPackValue)} apv=${pack.totalValueUsd} card_prices=[${cardPrices}]`
      );
    }
  }
}
