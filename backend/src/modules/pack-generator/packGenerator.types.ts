export interface CreatePackGenerationRequest {
  tierName: string;
  strategyName: string;
  count: number;
  /** Starting dry streak (consecutive simulated/generated packs strictly below retail) for retail_swing boost. */
  dryStreakInitial?: number;
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
  branch: "retail_swing" | "god_hit" | "expansion";
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

export interface SimulatePackRequest {
  tierName: string;
  count: number;
  dryStreakInitial?: number;
}

export interface RegeneratePackCardsRequest {
  /** `packs.id` values to re-roll with `StandardGenerationStrategy` and replace `pack_card` links. */
  packIds: string[];
}

export interface RegeneratePackCardsResultItem {
  packId: string;
  tierName: string;
  branch: GeneratedPack["branch"];
  totalValueUsd: string;
  targetPackValueUsd: string;
  /** `card.id` values written to `pack_card` (catalog row PKs). */
  catalogCardIds: string[];
  /** External TCG / `card.card_id` values for the assigned cards. */
  tcgExternalCardIds: string[];
}

export interface RegeneratePackCardsResult {
  packs: RegeneratePackCardsResultItem[];
}

/** Result of `POST /pack-generator/sync-catalog-prices` (price sync + eligible pack regeneration). */
export interface CatalogPriceSyncRegenerationResult {
  significantPriceChangeCardCount: number;
  regeneratedPackCount: number;
  regeneratedPacks: RegeneratePackCardsResultItem[];
}

export interface PackSimulationResult {
  tierName: string;
  simulationCount: number;
  retailPriceUsd: string;
  targetPackValueUsd: string;
  targetMargin: string;
  winRateFloor: string;
  winRateCeiling: string;
  results: {
    avgRealisedValueUsd: string;
    medianRealisedValueUsd: string;
    p5RealisedValueUsd: string;
    p95RealisedValueUsd: string;
    realisedMargin: string;
    /**
     * Aggregate: `(sum retail − sum realised card value) / sum realised card value`.
     * **Positive** → company gains vs aggregate card value; **negative** → aggregate card value exceeds total retail paid.
     */
    netProfitLossPctOnCardValue: string;
    /** `simulationCount × retail` (total sticker revenue for the run). */
    aggregateTotalRetailUsd: string;
    /** Sum of all packs’ realised card values. */
    aggregateTotalRealisedValueUsd: string;
    winRate: string;
    winCount: number;
    /** Packs with realised value strictly below retail (`simulationCount - winCount`). */
    lossCount: number;
    godHitCount: number;
    retailSwingCount: number;
    /**
     * Counts that partition the run (`simulationCount` each).
     * `byBranch`: one label per pack from `GeneratedPack.branch` (`standard` = `expansion`).
     * `byOutcome`: win vs loss from realised value vs retail.
     */
    packCounts: {
      byBranch: {
        godHit: number;
        standard: number;
        retailSwing: number;
        total: number;
      };
      byOutcome: {
        win: number;
        loss: number;
        total: number;
      };
    };
    distribution: { band: string; count: number; pct: string }[];
  };
  acceptanceCriteria: {
    marginWithin2ppOfTarget: boolean;
    winRateAboveFloor: boolean;
    winRateBelowCeiling: boolean;
    p5AboveZero: boolean;
    allPassed: boolean;
  };
  packs: {
    sequence: number;
    branch: GeneratedPack["branch"];
    retailPriceUsd: string;
    targetPackValueUsd: string;
    realisedValueUsd: string;
    diffVsRetailUsd: string;
    diffVsTpvUsd: string;
    isWin: boolean;
    cards: { name: string; rarity: string; slot: GeneratedPackCard["slot"]; marketValueUsd: string }[];
  }[];
}
