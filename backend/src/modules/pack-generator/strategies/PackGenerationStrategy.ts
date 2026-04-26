import Decimal from "decimal.js";
import type { CatalogCard, GeneratedPack } from "../packGenerator.types";

export interface CandidateCard {
  card: CatalogCard;
  marketValue: Decimal;
}

export interface PackGenerationStrategy {
  readonly name: string;
  generateOnePack(
    candidates: CandidateCard[],
    targetPackValue: Decimal,
    sequence: number
  ): GeneratedPack;
}
