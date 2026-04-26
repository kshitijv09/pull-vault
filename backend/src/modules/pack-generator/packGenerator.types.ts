export interface CreatePackGenerationRequest {
  tierName: string;
  strategyName: string;
  count: number;
}

export interface CatalogCard {
  id: string;
  cardId: string;
  name: string;
  cardSet: string;
  imageUrl: string;
  rarity: string;
  marketValueUsd: string;
}

export interface GeneratedPackCard extends CatalogCard {
  slot: "anchor" | "stabilizer" | "filler" | "bulk";
}

export interface GeneratedPack {
  sequence: number;
  branch: "god_hit" | "expansion";
  targetPackValueUsd: string;
  totalValueUsd: string;
  cards: GeneratedPackCard[];
}

export interface GeneratePackBatchResult {
  tierName: string;
  strategyName: string;
  count: number;
  targetPackValueUsd: string;
  generatedAt: string;
  packs: GeneratedPack[];
}
