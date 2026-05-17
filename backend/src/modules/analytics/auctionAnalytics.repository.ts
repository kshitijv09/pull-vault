import { query } from "../../db";
import type { AuctionAnalyticsGroupBy } from "./auctionAnalytics.types";

export interface AuctionEndedFilters {
  fromIso?: string;
  toIso?: string;
}

/** Params always `[fromNullable, toNullable]` for listing end_time window */
function listingEndedParams(filters: AuctionEndedFilters): unknown[] {
  return [filters.fromIso ?? null, filters.toIso ?? null];
}

const LISTING_ENDED_SQL = `
  al.status IN ('sold', 'unsold')
  AND ($1::timestamptz IS NULL OR al.end_time >= $1::timestamptz)
  AND ($2::timestamptz IS NULL OR al.end_time <= $2::timestamptz)
`;

export class AuctionAnalyticsRepository {
  async getSettledRollup(filters: AuctionEndedFilters): Promise<{
    settledTotal: number;
    soldCount: number;
    unsoldCount: number;
    withOpenBidActivityCount: number;
    needsFraudReviewCount: number;
    sealedPhaseCount: number;
  }> {
    const params = listingEndedParams(filters);
    const res = await query<{
      settled_total: string;
      sold_n: string;
      unsold_n: string;
      with_bids_n: string;
      flagged_n: string;
      sealed_n: string;
    }>(
      `
        SELECT
          COUNT(*)::text AS settled_total,
          COUNT(*) FILTER (WHERE al.status = 'sold')::text AS sold_n,
          COUNT(*) FILTER (WHERE al.status = 'unsold')::text AS unsold_n,
          COUNT(*) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM auction_bid_history bh WHERE bh.auction_listing_id = al.id
            )
          )::text AS with_bids_n,
          COUNT(*) FILTER (WHERE al.needs_fraud_review)::text AS flagged_n,
          COUNT(*) FILTER (WHERE al.sealed_phase_active)::text AS sealed_n
        FROM auction_listings al
        WHERE ${LISTING_ENDED_SQL}
      `,
      params
    );
    const row = res.rows[0];
    return {
      settledTotal: Number(row?.settled_total ?? "0"),
      soldCount: Number(row?.sold_n ?? "0"),
      unsoldCount: Number(row?.unsold_n ?? "0"),
      withOpenBidActivityCount: Number(row?.with_bids_n ?? "0"),
      needsFraudReviewCount: Number(row?.flagged_n ?? "0"),
      sealedPhaseCount: Number(row?.sealed_n ?? "0")
    };
  }

  async getAvgDistinctBiddersAmongListingsWithOpenBids(filters: AuctionEndedFilters): Promise<string | null> {
    const params = listingEndedParams(filters);
    const res = await query<{ avg_d: string | null }>(
      `
        SELECT AVG(per_listing.d)::text AS avg_d
        FROM (
          SELECT COUNT(DISTINCT bh.bidder_id)::numeric AS d
          FROM auction_listings al
          INNER JOIN auction_bid_history bh ON bh.auction_listing_id = al.id
          WHERE ${LISTING_ENDED_SQL}
          GROUP BY al.id
        ) per_listing
      `,
      params
    );
    return res.rows[0]?.avg_d ?? null;
  }

  async getAvgOpenBidRowsAmongListingsWithBids(filters: AuctionEndedFilters): Promise<string | null> {
    const params = listingEndedParams(filters);
    const res = await query<{ avg_c: string | null }>(
      `
        SELECT AVG(per_listing.c)::text AS avg_c
        FROM (
          SELECT COUNT(*)::numeric AS c
          FROM auction_listings al
          INNER JOIN auction_bid_history bh ON bh.auction_listing_id = al.id
          WHERE ${LISTING_ENDED_SQL}
          GROUP BY al.id
        ) per_listing
      `,
      params
    );
    return res.rows[0]?.avg_c ?? null;
  }

  async getPricingVsMarket(filters: AuctionEndedFilters): Promise<{
    soldWithPositiveMarketCount: number;
    avgRatio: string | null;
    medianRatio: string | null;
  }> {
    const params = listingEndedParams(filters);
    const res = await query<{
      n: string;
      avg_ratio: string | null;
      med_ratio: string | null;
    }>(
      `
        SELECT
          COUNT(*)::text AS n,
          AVG(al.current_high_bid / NULLIF(c.market_value_usd, 0))::text AS avg_ratio,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY (al.current_high_bid / NULLIF(c.market_value_usd, 0))
          )::text AS med_ratio
        FROM auction_listings al
        INNER JOIN user_cards uc ON uc.id = al.card_id
        INNER JOIN card c ON c.id = uc.card_id
        WHERE al.status = 'sold'
          AND c.market_value_usd > 0
          AND ${LISTING_ENDED_SQL}
      `,
      params
    );
    const row = res.rows[0];
    return {
      soldWithPositiveMarketCount: Number(row?.n ?? "0"),
      avgRatio: row?.avg_ratio ?? null,
      medianRatio: row?.med_ratio ?? null
    };
  }

  async getOpenPhaseSnipeCounts(
    filters: AuctionEndedFilters,
    snipeWindowSeconds: number
  ): Promise<{ soldWithOpenBids: number; soldSniped: number }> {
    const params = [...listingEndedParams(filters), snipeWindowSeconds];
    const res = await query<{ total: string; sniped: string }>(
      `
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (
            WHERE lb.last_open_bid_at >= al.end_time - ($3::bigint * interval '1 second')
          )::text AS sniped
        FROM auction_listings al
        INNER JOIN LATERAL (
          SELECT MAX(bh.bid_at) AS last_open_bid_at
          FROM auction_bid_history bh
          WHERE bh.auction_listing_id = al.id
        ) lb ON true
        WHERE al.status = 'sold'
          AND lb.last_open_bid_at IS NOT NULL
          AND ${LISTING_ENDED_SQL}
      `,
      params
    );
    const row = res.rows[0];
    return {
      soldWithOpenBids: Number(row?.total ?? "0"),
      soldSniped: Number(row?.sniped ?? "0")
    };
  }

  async getTimeseries(
    filters: AuctionEndedFilters,
    groupBy: AuctionAnalyticsGroupBy,
    order: "asc" | "desc"
  ): Promise<
    Array<{
      bucketStart: Date;
      settledTotal: string;
      soldN: string;
      unsoldN: string;
      withBidsN: string;
      flaggedN: string;
    }>
  > {
    const bucket = groupBy === "week" ? "week" : groupBy === "month" ? "month" : "day";
    const params = listingEndedParams(filters);
    const res = await query<{
      bucket_start: Date;
      settled_total: string;
      sold_n: string;
      unsold_n: string;
      with_bids_n: string;
      flagged_n: string;
    }>(
      `
        SELECT
          date_trunc('${bucket}', al.end_time) AS bucket_start,
          COUNT(*)::text AS settled_total,
          COUNT(*) FILTER (WHERE al.status = 'sold')::text AS sold_n,
          COUNT(*) FILTER (WHERE al.status = 'unsold')::text AS unsold_n,
          COUNT(*) FILTER (
            WHERE EXISTS (
              SELECT 1 FROM auction_bid_history bh WHERE bh.auction_listing_id = al.id
            )
          )::text AS with_bids_n,
          COUNT(*) FILTER (WHERE al.needs_fraud_review)::text AS flagged_n
        FROM auction_listings al
        WHERE ${LISTING_ENDED_SQL}
        GROUP BY 1
        ORDER BY 1 ${order.toUpperCase()}
      `,
      params
    );
    return res.rows.map((row) => ({
      bucketStart: row.bucket_start,
      settledTotal: row.settled_total,
      soldN: row.sold_n,
      unsoldN: row.unsold_n,
      withBidsN: row.with_bids_n,
      flaggedN: row.flagged_n
    }));
  }
}
