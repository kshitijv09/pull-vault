import Decimal from "decimal.js";
import { query } from "../../db";
import { getManyCardMarketPricesUsd } from "../../infra/redis/cardPriceStore";

export interface PortfolioComputationResult {
  /** Sum of per-card market value (Redis live price when present, else catalog `market_value_usd`). */
  totalPortfolioValueUsd: string;
  /** Sum of `user_cards.acquisition_price` for the user. */
  totalAcquisitionCostUsd: string;
  cardInstanceCount: number;
  /** How many owned instances used catalog price because Redis had no live value. */
  usedFallbackPriceCount: number;
}

/**
 * Computes the user's collection market value and acquisition cost.
 * Shared by HTTP handlers, the daily snapshot job, and any other caller.
 */
export async function computeUserPortfolioValueUsd(userId: string): Promise<PortfolioComputationResult> {
  const rows = await query<{ card_id: string; market_value_usd: string; acquisition_price: string }>(
    `
      SELECT
        TRIM(c.card_id) AS card_id,
        c.market_value_usd::text AS market_value_usd,
        uc.acquisition_price::text AS acquisition_price
      FROM user_cards uc
      INNER JOIN card c ON c.id = uc.card_id
      WHERE uc.user_id = $1::uuid
    `,
    [userId]
  );

  if (rows.rows.length === 0) {
    return {
      totalPortfolioValueUsd: "0.00",
      totalAcquisitionCostUsd: "0.00",
      cardInstanceCount: 0,
      usedFallbackPriceCount: 0
    };
  }

  const distinctIds = [...new Set(rows.rows.map((r) => r.card_id.trim()).filter(Boolean))];
  const liveById = await getManyCardMarketPricesUsd(distinctIds);

  let usedFallback = 0;
  let totalMarket = new Decimal(0);
  let totalAcquisition = new Decimal(0);

  for (const r of rows.rows) {
    const id = r.card_id.trim();
    const live = liveById[id];
    if (live != null && live !== "") {
      totalMarket = totalMarket.plus(live);
    } else {
      totalMarket = totalMarket.plus(r.market_value_usd);
      usedFallback += 1;
    }
    totalAcquisition = totalAcquisition.plus(r.acquisition_price ?? "0");
  }

  return {
    totalPortfolioValueUsd: totalMarket.toDecimalPlaces(2).toFixed(2),
    totalAcquisitionCostUsd: totalAcquisition.toDecimalPlaces(2).toFixed(2),
    cardInstanceCount: rows.rows.length,
    usedFallbackPriceCount: usedFallback
  };
}
