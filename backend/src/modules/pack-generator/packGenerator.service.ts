import Decimal from "decimal.js";
import { AppError } from "../../shared/errors/AppError";
import { packGeneratorConfig } from "./packGenerator.config";
import { PackGeneratorRepository } from "./packGenerator.repository";
import { PriceSyncService } from "./priceSync.service";
import type {
  CreatePackGenerationRequest,
  GeneratePackBatchResult,
  GeneratedPack
} from "./packGenerator.types";
import type { PackGenerationStrategy, CandidateCard } from "./strategies/PackGenerationStrategy";
import { StandardGenerationStrategy } from "./strategies/StandardGenerationStrategy";

export class PackGeneratorService {
  private readonly strategies: Map<string, PackGenerationStrategy> = new Map();

  constructor(
    private readonly repository: PackGeneratorRepository,
    private readonly priceSyncService: PriceSyncService
  ) {
    // Register strategies
    this.registerStrategy(new StandardGenerationStrategy());
  }

  private registerStrategy(strategy: PackGenerationStrategy): void {
    this.strategies.set(strategy.name.toLowerCase(), strategy);
  }

  async generatePackBatch(body: unknown): Promise<GeneratePackBatchResult> {
    const request = this.parseRequest(body);
    const strategy = this.getStrategy(request.strategyName);

    // Sync prices before generation
    // await this.priceSyncService.syncAllPrices();

    const tierKey = request.tierName.toLowerCase();
    const tier = packGeneratorConfig.tierConfig[tierKey];
    if (!tier) {
      throw new AppError(`Unknown tier_name '${request.tierName}'.`, 400);
    }

    const candidateCards = await this.repository.findAllCatalogCards();
    if (candidateCards.length === 0) {
      throw new AppError("No catalog cards available for pack generation.", 404);
    }

    const targetPackValue = new Decimal(tier.retailPriceUsd)
      .mul(packGeneratorConfig.targetPackValueRatio)
      .toDecimalPlaces(2);
      
    const candidates: CandidateCard[] = candidateCards.map((card) => ({
      card,
      marketValue: new Decimal(card.marketValueUsd)
    }));

    const packs: GeneratedPack[] = [];
    for (let i = 0; i < request.count; i += 1) {
      packs.push(strategy.generateOnePack(candidates, targetPackValue, i + 1));
    }
    this.assertBatchVarianceWithinBounds(packs, targetPackValue);
    this.logGeneratedPackPricing(packs, targetPackValue, request.tierName);

    // Persist to database
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

  private getStrategy(strategyName: string): PackGenerationStrategy {
    const strategy = this.strategies.get(strategyName.toLowerCase());
    if (!strategy) {
      throw new AppError(
        `Unsupported strategy_name '${strategyName}'. Available: ${Array.from(this.strategies.keys()).join(", ")}`,
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

    return {
      tierName: tierRaw,
      strategyName: strategyRaw,
      count
    };
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

  private assertBatchVarianceWithinBounds(packs: GeneratedPack[], targetPackValue: Decimal): void {
    if (packs.length === 0) return;
    if (packs.length < 100) return;
    const total = packs.reduce((sum, pack) => sum.plus(new Decimal(pack.totalValueUsd)), new Decimal(0));
    const average = total.div(packs.length);
    const minPreferred = targetPackValue.mul(0.96);
    const maxAllowed = targetPackValue;
    if (average.lessThan(minPreferred) || average.greaterThan(maxAllowed)) {
      throw new AppError(
        `Generated batch average (${this.toMoneyString(average)}) is outside preferred 96%-100% of TPV (${this.toMoneyString(
          targetPackValue
        )}).`,
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
