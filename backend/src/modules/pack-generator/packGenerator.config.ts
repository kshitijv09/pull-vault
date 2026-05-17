import Decimal from "decimal.js";

/** Cards per pack from `StandardGenerationStrategy` (batch persist + simulate). Purchase reads these from `pack_card`. */
export const PACK_GENERATOR_CARDS_PER_PACK = 3;

/**
 * After catalog price sync, if a card's price moves by more than this **relative** amount (up or down),
 * eligible `packs` templates containing that card may be auto-regenerated (see `PackGeneratorService`).
 */
export const CATALOG_PRICE_PACK_REGEN_RELATIVE_THRESHOLD = new Decimal("0.05");

export interface PackGeneratorTierConfig {
  retailPriceUsd: number;
}

export interface PackGeneratorConfig {
  /**
   * Fraction of retail used as target pack value (TPV): `TPV = retail × ratio`.
   * **0.80** → 20% target value headroom vs retail (see `architecture/pack-economics.md`).
   */
  targetPackValueRatio: number;
  /** Simulation: minimum acceptable share of packs with realised value ≥ retail (−3pp tolerance). */
  winRateFloor: number;
  /** Simulation: maximum acceptable share of packs with realised ≥ retail (+3pp tolerance). */
  winRateCeiling: number;
  /**
   * Base probability of **retail_swing** at dry streak 0.
   * Effective = `min(max, base + streak × perDryPack)` — `effectiveRetailSwingProbability`.
   */
  retailSwingProbability: number;
  /** Upper cap on boosted retail_swing probability. */
  retailSwingProbabilityMax: number;
  /** Additive boost per integer dry streak (consecutive packs strictly below retail). */
  retailSwingProbabilityPerDryPack: number;
  /** Max total realised value for a retail_swing pack, as multiple of retail. */
  retailSwingPackValueCapRatio: number;
  defaultStrategyName: string;
  tierConfig: Record<string, PackGeneratorTierConfig>;
  fallbackMidPrices: Record<string, number>;
}

/**
 * Pack-tier retail (USD), three tiers. TPV = retail × `targetPackValueRatio` (0.80).
 *
 * **retail_swing:** targets realised ≥ retail; cap = `retailSwingPackValueCapRatio × retail`.
 * **god_hit** (10%) / **expansion:** TPV-budgeted construction.
 */
export const packGeneratorConfig: PackGeneratorConfig = {
  targetPackValueRatio: 0.85,
  winRateFloor: 0,
  winRateCeiling: 0.28,
  retailSwingProbability: 0.15,
  retailSwingProbabilityMax: 0.2,
  retailSwingProbabilityPerDryPack: 0.0025,
  retailSwingPackValueCapRatio: 1.2,
  defaultStrategyName: "standard",
  tierConfig: {
    entry: { retailPriceUsd: 5499 },
    core: { retailPriceUsd: 13499 },
    ultra: { retailPriceUsd: 31999 }
  },
  fallbackMidPrices: {
    common: 0.15,
    uncommon: 0.75,
    rare: 2.5,
    super_rare: 15.0,
    starlight_rare: 125.0,
    default: 1.0
  }
};

/** Effective retail_swing draw probability; strategy clamps so swing + god_hit < 1. */
export function effectiveRetailSwingProbability(dryStreak: number): number {
  const { retailSwingProbability, retailSwingProbabilityMax, retailSwingProbabilityPerDryPack } =
    packGeneratorConfig;
  const s = Math.max(0, Math.floor(Number.isFinite(dryStreak) ? dryStreak : 0));
  return Math.min(retailSwingProbabilityMax, retailSwingProbability + s * retailSwingProbabilityPerDryPack);
}

/** Upper bound inclusive for each band (USD). Last band is unbounded. */
export const CARD_VALUE_USD_RARITY_BANDS: readonly { maxUsd: number; rarityKey: string; label: string }[] = [
  { maxUsd: 1999.99, rarityKey: "common", label: "Common" },
  { maxUsd: 4999.99, rarityKey: "uncommon", label: "Uncommon" },
  { maxUsd: 9999.99, rarityKey: "rare", label: "Rare" },
  { maxUsd: 24999.99, rarityKey: "super_rare", label: "Super Rare" },
  { maxUsd: Number.POSITIVE_INFINITY, rarityKey: "starlight_rare", label: "Starlight Rare" }
];

export const RARITY_RANK: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  super_rare: 3,
  starlight_rare: 4
};

export const ANCHOR_MIN_RARITY_RANK = RARITY_RANK.rare;

export function rarityFromMarketValueUsd(usd: Decimal): { rarityKey: string; label: string } {
  const p = usd.toDecimalPlaces(2);
  for (const b of CARD_VALUE_USD_RARITY_BANDS) {
    if (!Number.isFinite(b.maxUsd) || p.lessThanOrEqualTo(b.maxUsd)) {
      return { rarityKey: b.rarityKey, label: b.label };
    }
  }
  return {
    rarityKey: "starlight_rare",
    label: "Starlight Rare"
  };
}

function normalizedRarityKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

export function rarityRankFromLabel(raw: string): number {
  const k = normalizedRarityKey(raw);
  if (k === "super_rare" || k === "superrare") return RARITY_RANK.super_rare;
  if (k === "starlight_rare" || k === "starlightrare") return RARITY_RANK.starlight_rare;
  return RARITY_RANK[k] ?? RARITY_RANK.common;
}

// /**
//  * Synthetic USD ladder for `/pack-generator/simulate`. Includes **low fillers** so
//  * 3-card `retail_swing` bands (e.g. retail $5,499–cap $6,599) and TPV-budget fills stay feasible.
//  * Simulate now reads candidates from the `card` table instead of this in-code list.
//  */
// export const SIMULATION_ONLY_CARD_PRICES_USD: readonly number[] = [
//   50, 75, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 900, 950,
//   1000, 1100, 1169, 1200, 1300, 1400, 1423.33, 1500, 1500, 1500, 1600, 1600, 1698.75, 1700, 1742,
//   1799, 1809.01, 1900, 1999.99, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2649.06, 2700, 2800,
//   2900, 3000, 3200, 3400, 3600, 3700, 3900,
//   5200, 5700, 5950, 5999.69, 6199.95, 6485.75, 6999.99, 7355.65, 7500, 8000, 8100, 8389.79,
//   10249.89, 10799.99, 10999.97, 11650.24, 14999.99, 16952.86, 26500, 32999.99
// ];
