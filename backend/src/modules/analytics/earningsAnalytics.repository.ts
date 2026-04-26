import { query } from "../../db";
import type {
  EarningsEventType,
  EarningsGroupBy,
  EarningsLedgerEventRow,
  EarningsSortOrder,
  EarningsSourceBreakdownRow,
  EarningsSummary,
  EarningsTimeseriesPoint
} from "./earningsAnalytics.types";

export interface EarningsQueryFilters {
  fromIso?: string;
  toIso?: string;
  eventTypes?: EarningsEventType[];
}

function buildWhereClause(filters: EarningsQueryFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.fromIso) {
    params.push(filters.fromIso);
    conditions.push(`occurred_at >= $${params.length}::timestamptz`);
  }
  if (filters.toIso) {
    params.push(filters.toIso);
    conditions.push(`occurred_at <= $${params.length}::timestamptz`);
  }
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    params.push(filters.eventTypes);
    conditions.push(`event_type = ANY($${params.length}::text[])`);
  }

  if (conditions.length === 0) {
    return { clause: "", params };
  }
  return { clause: `WHERE ${conditions.join(" AND ")}`, params };
}

export class EarningsAnalyticsRepository {
  async getSummary(filters: EarningsQueryFilters): Promise<EarningsSummary> {
    const { clause, params } = buildWhereClause(filters);
    const res = await query<{
      total_amount_gained_usd: string | null;
      total_events: string;
      average_per_event_usd: string | null;
      largest_single_gain_usd: string | null;
    }>(
      `
        SELECT
          COALESCE(SUM(amount_gained_usd), 0)::text AS total_amount_gained_usd,
          COUNT(*)::text AS total_events,
          COALESCE(AVG(amount_gained_usd), 0)::text AS average_per_event_usd,
          COALESCE(MAX(amount_gained_usd), 0)::text AS largest_single_gain_usd
        FROM company_earnings_ledger
        ${clause}
      `,
      params
    );

    const row = res.rows[0];
    return {
      totalAmountGainedUsd: row?.total_amount_gained_usd ?? "0",
      totalEvents: Number(row?.total_events ?? "0"),
      averagePerEventUsd: row?.average_per_event_usd ?? "0",
      largestSingleGainUsd: row?.largest_single_gain_usd ?? "0"
    };
  }

  async getSourceBreakdown(
    filters: EarningsQueryFilters,
    sortBy: "amount" | "events" | "average",
    order: EarningsSortOrder
  ): Promise<EarningsSourceBreakdownRow[]> {
    const { clause, params } = buildWhereClause(filters);
    const sortColumn =
      sortBy === "events"
        ? "total_events"
        : sortBy === "average"
          ? "average_per_event_usd"
          : "total_amount_gained_usd";

    const res = await query<{
      event_type: EarningsEventType;
      total_amount_gained_usd: string;
      total_events: string;
      average_per_event_usd: string;
    }>(
      `
        SELECT
          event_type,
          COALESCE(SUM(amount_gained_usd), 0)::text AS total_amount_gained_usd,
          COUNT(*)::text AS total_events,
          COALESCE(AVG(amount_gained_usd), 0)::text AS average_per_event_usd
        FROM company_earnings_ledger
        ${clause}
        GROUP BY event_type
        ORDER BY ${sortColumn} ${order.toUpperCase()}, event_type ASC
      `,
      params
    );

    return res.rows.map((row) => ({
      eventType: row.event_type,
      totalAmountGainedUsd: row.total_amount_gained_usd,
      totalEvents: Number(row.total_events),
      averagePerEventUsd: row.average_per_event_usd
    }));
  }

  async getTimeseries(
    filters: EarningsQueryFilters,
    groupBy: EarningsGroupBy,
    order: EarningsSortOrder
  ): Promise<EarningsTimeseriesPoint[]> {
    const { clause, params } = buildWhereClause(filters);
    const bucket = groupBy === "hour" ? "hour" : groupBy === "week" ? "week" : groupBy === "month" ? "month" : "day";

    const res = await query<{
      bucket_start: Date;
      total_amount_gained_usd: string;
      total_events: string;
    }>(
      `
        SELECT
          date_trunc('${bucket}', occurred_at) AS bucket_start,
          COALESCE(SUM(amount_gained_usd), 0)::text AS total_amount_gained_usd,
          COUNT(*)::text AS total_events
        FROM company_earnings_ledger
        ${clause}
        GROUP BY bucket_start
        ORDER BY bucket_start ${order.toUpperCase()}
      `,
      params
    );

    return res.rows.map((row) => ({
      bucketStart: row.bucket_start.toISOString(),
      totalAmountGainedUsd: row.total_amount_gained_usd,
      totalEvents: Number(row.total_events)
    }));
  }

  async listEvents(
    filters: EarningsQueryFilters,
    options: {
      sortBy: "occurred_at" | "amount_gained_usd" | "event_type" | "created_at";
      order: EarningsSortOrder;
      limit: number;
      offset: number;
    }
  ): Promise<EarningsLedgerEventRow[]> {
    const { clause, params } = buildWhereClause(filters);
    params.push(options.limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(options.offset);
    const offsetPlaceholder = `$${params.length}`;

    const res = await query<{
      id: string;
      event_type: EarningsEventType;
      transaction_id: string;
      amount_gained_usd: string;
      currency_code: string;
      occurred_at: Date;
      metadata: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `
        SELECT
          id,
          event_type,
          transaction_id,
          amount_gained_usd::text AS amount_gained_usd,
          currency_code,
          occurred_at,
          metadata,
          created_at
        FROM company_earnings_ledger
        ${clause}
        ORDER BY ${options.sortBy} ${options.order.toUpperCase()}, id ASC
        LIMIT ${limitPlaceholder}
        OFFSET ${offsetPlaceholder}
      `,
      params
    );

    return res.rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      transactionId: row.transaction_id,
      amountGainedUsd: row.amount_gained_usd,
      currencyCode: row.currency_code,
      occurredAt: row.occurred_at.toISOString(),
      metadata: row.metadata ?? {},
      createdAt: row.created_at.toISOString()
    }));
  }
}
