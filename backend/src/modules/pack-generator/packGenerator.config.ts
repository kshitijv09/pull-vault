export interface PackGeneratorTierConfig {
  retailPriceUsd: number;
}

export interface PackGeneratorConfig {
  targetPackValueRatio: number;
  defaultStrategyName: string;
  tierConfig: Record<string, PackGeneratorTierConfig>;
  fallbackMidPrices: Record<string, number>;
}

/**
 * Centralized tier economics config for pack generation.
 * TPV = retailPriceUsd * targetPackValueRatio
 */
export const packGeneratorConfig: PackGeneratorConfig = {
  targetPackValueRatio: 0.9,
  defaultStrategyName: "standard",
  tierConfig: {
    elite: { retailPriceUsd: 10666.67 },
    pinnacle: { retailPriceUsd: 16000 },
    zenith: { retailPriceUsd: 23111.11 }
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
