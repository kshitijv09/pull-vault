import Decimal from "decimal.js";
import type { CatalogCard, GeneratedPack } from "../packGenerator.types";

export interface CandidateCard {
  card: CatalogCard;
  marketValue: Decimal;
}

/**
 * `() => number` source of randomness consumed by a strategy. Defaults to
 * `Math.random` for legacy callers (pack-generator batch); the fairness
 * fulfillment strategy supplies a seeded HMAC-SHA256 stream so outcomes are
 * reproducible at Phase 3 reveal time.
 */
export type RandomSource = () => number;

export interface PackGenerationStrategy {
  readonly name: string;
  generateOnePack(
    candidates: CandidateCard[],
    targetPackValue: Decimal,
    sequence: number,
    retailPrice: Decimal,
    dryStreakSinceRetailWin: number,
    rand?: RandomSource
  ): GeneratedPack;
}
