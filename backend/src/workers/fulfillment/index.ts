import { AppError } from "../../shared/errors/AppError";
import {
  PACK_FAIRNESS_MODE,
  type PackFairnessMode
} from "../../shared/constants/packFairnessCommit.constants";
import { FairnessPackFulfillment } from "./FairnessPackFulfillment";
import { LegacyPackCardFulfillment } from "./LegacyPackCardFulfillment";
import type { PackFulfillmentStrategy } from "./PackFulfillmentStrategy";

export * from "./PackFulfillmentStrategy";
export { FairnessPackFulfillment } from "./FairnessPackFulfillment";
export { LegacyPackCardFulfillment } from "./LegacyPackCardFulfillment";

/**
 * Strategy registry consumed by the pack-purchase queue worker. New drops
 * default to `fairness`; legacy drops are routed by an explicit per-row
 * `drops.fairness_mode = 'legacy'`.
 */
export class PackFulfillmentStrategyRegistry {
  private readonly strategies: Map<PackFairnessMode, PackFulfillmentStrategy>;
  public readonly defaultStrategyName: PackFairnessMode;

  constructor(
    strategies: PackFulfillmentStrategy[] = [
      new FairnessPackFulfillment(),
      new LegacyPackCardFulfillment()
    ],
    defaultStrategyName: PackFairnessMode = PACK_FAIRNESS_MODE.FAIRNESS
  ) {
    this.strategies = new Map();
    for (const strategy of strategies) {
      this.strategies.set(strategy.name, strategy);
    }
    if (!this.strategies.has(defaultStrategyName)) {
      throw new Error(
        `PackFulfillmentStrategyRegistry: default strategy '${defaultStrategyName}' was not registered.`
      );
    }
    this.defaultStrategyName = defaultStrategyName;
  }

  resolve(name: PackFairnessMode | string | null | undefined): PackFulfillmentStrategy {
    const key = (name ?? this.defaultStrategyName) as PackFairnessMode;
    const strategy = this.strategies.get(key);
    if (!strategy) {
      throw new AppError(`Unknown pack fulfillment strategy '${key}'.`, 500);
    }
    return strategy;
  }
}
