import { query } from "../../db";
import type {
  HealthAlertKey,
  HealthAlertRow,
  HealthAlertSeverity,
  RateLimitBlockScope
} from "./platformHealth.types";

/**
 * Repository for the B5 Platform Health Dashboard.
 *
 * Each method below returns the rawest shape the service needs; ratios,
 * derived fields, and statistical decisions all live in the service so they
 * stay reproducible and unit-testable.
 *
 * Index map (justifies queries here ↔ indexes in migrations 035-037):
 *   • `rlbe_occurred_at_idx`         → `countBlocksSince`, `listScopeBreakdownSince`
 *   • `rlbe_scope_occurred_idx`      → `listScopeBreakdownSince`
 *   • `rlbe_client_ip_occurred_idx`  → `listTopBlockedIpsSince`
 *   • `company_earnings_ledger`      → revenue rollups
 *   • `pack_fairness_commit_drop_id_idx` + `pack_fairness_commit_user_drop_created_idx`
 *                                    → `countConsumedCommitsSince`, `countRevealsSince`
 *   • `pfve_occurred_at_idx`         → verify event counters
 *   • `hae_alert_key_fired_idx`      → recent alerts
 *   • `hae_unresolved_idx`           → open alerts widget
 *   • `hae_dedup_uidx`               → service-side per-minute alert dedup
 */
export interface WindowFilter {
  fromIso?: string;
  toIso?: string;
}

export interface ScopeCountRow {
  scope: RateLimitBlockScope;
  count: number;
}

export interface TopIpRow {
  clientIp: string;
  blocks: number;
}

export interface TierMarginRollup {
  tierName: string;
  packsOpened: number;
  retailRevenueUsd: string;
  realisedValueUsd: string;
  winningPacks: number;
}

export interface RevenueByEventTypeRow {
  eventType: string;
  totalUsd: string;
  events: number;
}

export interface PoolDriftRollup {
  dropId: string;
  dropName: string;
  poolSnapshotCreatedAt: string;
  medianDriftPct: string;
  maxDriftPct: string;
  cardsCompared: number;
}

export interface RarityObservationRow {
  tierName: string;
  /** Lowercased rarity key from `card.rarity`. */
  rarity: string;
  observed: number;
}

export interface TierWeightRow {
  tierName: string;
  /** Raw JSONB blob from `packs.rarity_weights`. */
  rarityWeights: Record<string, unknown>;
}

export interface FairnessUsageRollup {
  totalConsumedCommits: number;
  totalReveals: number;
  distinctUserPacksVerified: number;
  totalVerifyEvents: number;
  failedVerifyEvents: number;
}

export interface RetentionCohortRow {
  cohortStart: string;
  cohortSize: number;
  d1Active: number;
  d7Active: number;
  d30Active: number;
}

export class PlatformHealthRepository {
  /* ── Fraud ──────────────────────────────────────────────────────────── */

  async countBlocks(window: WindowFilter): Promise<number> {
    const where = whereOccurredAt(window);
    const res = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM rate_limit_block_event ${where.clause}`,
      where.params
    );
    return Number(res.rows[0]?.c ?? "0");
  }

  async listScopeBreakdown(window: WindowFilter): Promise<ScopeCountRow[]> {
    const where = whereOccurredAt(window);
    const res = await query<{ scope: RateLimitBlockScope; c: string }>(
      `
        SELECT scope, COUNT(*)::text AS c
        FROM rate_limit_block_event
        ${where.clause}
        GROUP BY scope
        ORDER BY scope ASC
      `,
      where.params
    );
    return res.rows.map((r) => ({ scope: r.scope, count: Number(r.c) }));
  }

  async listTopBlockedIps(window: WindowFilter, limit: number): Promise<TopIpRow[]> {
    const where = whereOccurredAt(window);
    const params = [...where.params, limit];
    const res = await query<{ client_ip: string; c: string }>(
      `
        SELECT client_ip, COUNT(*)::text AS c
        FROM rate_limit_block_event
        ${where.clause}
        GROUP BY client_ip
        ORDER BY COUNT(*) DESC, client_ip ASC
        LIMIT $${params.length}
      `,
      params
    );
    return res.rows.map((r) => ({ clientIp: r.client_ip, blocks: Number(r.c) }));
  }

  async insertBlock(input: {
    scope: RateLimitBlockScope;
    userId: string | null;
    dropId: string | null;
    clientIp: string;
    endpoint: string;
  }): Promise<void> {
    await query(
      `
        INSERT INTO rate_limit_block_event (scope, user_id, drop_id, client_ip, endpoint)
        VALUES ($1, $2::uuid, $3::uuid, $4, $5)
      `,
      [input.scope, input.userId, input.dropId, input.clientIp, input.endpoint]
    );
  }

  /* ── Economics ──────────────────────────────────────────────────────── */

  async getTierMarginRollups(window: WindowFilter): Promise<TierMarginRollup[]> {
    const where = whereCreatedAt(window, "up");
    const res = await query<{
      tier_name: string;
      packs_opened: string;
      retail_revenue_usd: string;
      realised_value_usd: string;
      winning_packs: string;
    }>(
      `
        WITH pack_outcomes AS (
          SELECT
            up.id                    AS user_pack_id,
            p.tier_name              AS tier_name,
            p.price::numeric         AS retail,
            COALESCE(SUM(c.market_value_usd), 0)::numeric AS realised
          FROM user_packs up
          JOIN packs p          ON p.id = up.pack_id
          LEFT JOIN user_cards uc ON uc.user_pack_id = up.id
          LEFT JOIN card c        ON c.id = uc.card_id
          ${where.clause}
          GROUP BY up.id, p.tier_name, p.price
        )
        SELECT
          tier_name,
          COUNT(*)::text                                   AS packs_opened,
          COALESCE(SUM(retail), 0)::text                   AS retail_revenue_usd,
          COALESCE(SUM(realised), 0)::text                 AS realised_value_usd,
          SUM(CASE WHEN realised >= retail THEN 1 ELSE 0 END)::text AS winning_packs
        FROM pack_outcomes
        GROUP BY tier_name
        ORDER BY tier_name ASC
      `,
      where.params
    );
    return res.rows.map((r) => ({
      tierName: r.tier_name,
      packsOpened: Number(r.packs_opened),
      retailRevenueUsd: r.retail_revenue_usd,
      realisedValueUsd: r.realised_value_usd,
      winningPacks: Number(r.winning_packs)
    }));
  }

  async getRevenueByEventType(window: WindowFilter): Promise<RevenueByEventTypeRow[]> {
    const where = whereOccurredAt(window);
    const res = await query<{
      event_type: string;
      total_usd: string;
      events: string;
    }>(
      `
        SELECT
          event_type,
          COALESCE(SUM(amount_gained_usd), 0)::text AS total_usd,
          COUNT(*)::text                            AS events
        FROM company_earnings_ledger
        ${where.clause}
        GROUP BY event_type
        ORDER BY event_type ASC
      `,
      where.params
    );
    return res.rows.map((r) => ({
      eventType: r.event_type,
      totalUsd: r.total_usd,
      events: Number(r.events)
    }));
  }

  async getRevenueSince(sinceIso: string, eventType: string): Promise<string> {
    const res = await query<{ total_usd: string }>(
      `
        SELECT COALESCE(SUM(amount_gained_usd), 0)::text AS total_usd
        FROM company_earnings_ledger
        WHERE event_type = $1 AND occurred_at >= $2::timestamptz
      `,
      [eventType, sinceIso]
    );
    return res.rows[0]?.total_usd ?? "0";
  }

  async getPoolDrifts(): Promise<PoolDriftRollup[]> {
    const res = await query<{
      drop_id: string;
      drop_name: string;
      pool_snapshot_created_at: string;
      median_drift_pct: string;
      max_drift_pct: string;
      cards_compared: string;
    }>(
      `
        WITH live_drift AS (
          SELECT
            s.drop_id,
            CASE
              WHEN s.market_value_usd_snapshot = 0 THEN 0
              ELSE ABS(c.market_value_usd - s.market_value_usd_snapshot)
                   / NULLIF(s.market_value_usd_snapshot, 0) * 100
            END::numeric AS drift_pct
          FROM drop_card_pool_snapshot s
          JOIN card c ON c.id = s.card_id
        )
        SELECT
          d.id::text AS drop_id,
          d.name AS drop_name,
          d.pool_snapshot_created_at::text AS pool_snapshot_created_at,
          COALESCE(
            (SELECT percentile_cont(0.5)
               WITHIN GROUP (ORDER BY drift_pct)
             FROM live_drift WHERE drop_id = d.id),
            0
          )::text AS median_drift_pct,
          COALESCE(
            (SELECT MAX(drift_pct) FROM live_drift WHERE drop_id = d.id),
            0
          )::text AS max_drift_pct,
          (SELECT COUNT(*)::text FROM live_drift WHERE drop_id = d.id) AS cards_compared
        FROM drops d
        WHERE d.pool_snapshot_fingerprint_hex IS NOT NULL
          AND d.status IN ('upcoming', 'live')
        ORDER BY d.start_time DESC
        LIMIT 10
      `
    );
    return res.rows.map((r) => ({
      dropId: r.drop_id,
      dropName: r.drop_name,
      poolSnapshotCreatedAt: r.pool_snapshot_created_at,
      medianDriftPct: r.median_drift_pct,
      maxDriftPct: r.max_drift_pct,
      cardsCompared: Number(r.cards_compared)
    }));
  }

  /* ── Fairness ───────────────────────────────────────────────────────── */

  async listObservedRarityCountsForFairnessDrops(
    window: WindowFilter
  ): Promise<RarityObservationRow[]> {
    const where = whereCreatedAt(window, "uc");
    const conditions = where.clause
      ? `${where.clause} AND d.fairness_mode = 'fairness'`
      : `WHERE d.fairness_mode = 'fairness'`;
    const res = await query<{ tier_name: string; rarity: string; observed: string }>(
      `
        SELECT
          p.tier_name AS tier_name,
          LOWER(c.rarity) AS rarity,
          COUNT(*)::text AS observed
        FROM user_cards uc
        JOIN card c          ON c.id = uc.card_id
        JOIN user_packs up   ON up.id = uc.user_pack_id
        JOIN packs p         ON p.id = up.pack_id
        JOIN drops d         ON d.id = up.drop_id
        ${conditions}
        GROUP BY p.tier_name, LOWER(c.rarity)
        ORDER BY p.tier_name, LOWER(c.rarity)
      `,
      where.params
    );
    return res.rows.map((r) => ({
      tierName: r.tier_name,
      rarity: r.rarity,
      observed: Number(r.observed)
    }));
  }

  async listAdvertisedWeights(): Promise<TierWeightRow[]> {
    const res = await query<{ tier_name: string; rarity_weights: Record<string, unknown> }>(
      `
        SELECT DISTINCT ON (tier_name)
          tier_name, rarity_weights
        FROM packs
        ORDER BY tier_name, created_at DESC
      `
    );
    return res.rows.map((r) => ({
      tierName: r.tier_name,
      rarityWeights: r.rarity_weights ?? {}
    }));
  }

  async getFairnessUsage(window: WindowFilter): Promise<FairnessUsageRollup> {
    const commits = await query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM pack_fairness_commit
        WHERE consumed_at IS NOT NULL
          ${window.fromIso ? `AND consumed_at >= $1::timestamptz` : ``}
          ${window.toIso ? `AND consumed_at <= $${window.fromIso ? 2 : 1}::timestamptz` : ``}
      `,
      [window.fromIso, window.toIso].filter(Boolean) as string[]
    );

    const verifyWhere = whereOccurredAt(window);
    const verify = await query<{
      total: string;
      failed: string;
      distinct_packs: string;
    }>(
      `
        SELECT
          COUNT(*)::text                                              AS total,
          COUNT(*) FILTER (WHERE result = 'fail')::text               AS failed,
          COUNT(DISTINCT user_pack_id)::text                          AS distinct_packs
        FROM pack_fairness_verify_event
        ${verifyWhere.clause}
      `,
      verifyWhere.params
    );

    return {
      totalConsumedCommits: Number(commits.rows[0]?.total ?? "0"),
      totalReveals: Number(commits.rows[0]?.total ?? "0"),
      totalVerifyEvents: Number(verify.rows[0]?.total ?? "0"),
      failedVerifyEvents: Number(verify.rows[0]?.failed ?? "0"),
      distinctUserPacksVerified: Number(verify.rows[0]?.distinct_packs ?? "0")
    };
  }

  async insertVerifyEvent(input: {
    userPackId: string;
    verifierUserId: string | null;
    verifierIp: string | null;
    result: "pass" | "fail";
    failingCheck: string | null;
  }): Promise<void> {
    await query(
      `
        INSERT INTO pack_fairness_verify_event
          (user_pack_id, verifier_user_id, verifier_ip, result, failing_check)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5)
      `,
      [
        input.userPackId,
        input.verifierUserId,
        input.verifierIp,
        input.result,
        input.failingCheck
      ]
    );
  }

  /* ── User health ────────────────────────────────────────────────────── */

  async countDistinctActiveUsersSince(sinceIso: string): Promise<number> {
    const res = await query<{ c: string }>(
      `
        WITH active AS (
          SELECT user_id FROM user_packs WHERE created_at >= $1::timestamptz
          UNION
          SELECT bidder_id FROM auction_bid_history WHERE bid_at >= $1::timestamptz
          UNION
          SELECT user_id FROM user_cards WHERE created_at >= $1::timestamptz
          UNION
          SELECT uc.user_id
          FROM marketplace_listings ml
          JOIN user_cards uc ON uc.id = ml.user_card_id
          WHERE ml.created_at >= $1::timestamptz
        )
        SELECT COUNT(DISTINCT user_id)::text AS c
        FROM active
        WHERE user_id IS NOT NULL
      `,
      [sinceIso]
    );
    return Number(res.rows[0]?.c ?? "0");
  }

  async getDropParticipation(window: WindowFilter): Promise<{
    distinctBuyers: number;
    activeDuringDrops: number;
  }> {
    const res = await query<{ distinct_buyers: string; active_during_drops: string }>(
      `
        WITH window_drops AS (
          SELECT id, start_time,
                 (start_time + make_interval(mins => duration_minutes)) AS end_time
          FROM drops
          WHERE start_time >= $1::timestamptz AND start_time <= $2::timestamptz
        ),
        buyers AS (
          SELECT DISTINCT up.user_id
          FROM user_packs up
          JOIN window_drops d ON d.id = up.drop_id
        ),
        active AS (
          SELECT DISTINCT user_id FROM user_packs up
          JOIN window_drops d
            ON up.created_at >= d.start_time AND up.created_at <= d.end_time
        )
        SELECT
          (SELECT COUNT(*)::text FROM buyers) AS distinct_buyers,
          (SELECT COUNT(*)::text FROM active) AS active_during_drops
      `,
      [window.fromIso ?? "1970-01-01", window.toIso ?? "9999-01-01"]
    );
    return {
      distinctBuyers: Number(res.rows[0]?.distinct_buyers ?? "0"),
      activeDuringDrops: Number(res.rows[0]?.active_during_drops ?? "0")
    };
  }

  async getAuctionParticipation(window: WindowFilter): Promise<{
    settled: number;
    withOpenBids: number;
  }> {
    const res = await query<{ settled: string; with_open_bids: string }>(
      `
        WITH settled_in_window AS (
          SELECT al.id
          FROM auction_listings al
          WHERE al.status IN ('sold', 'unsold')
            ${window.fromIso ? `AND al.end_time >= $1::timestamptz` : ``}
            ${window.toIso ? `AND al.end_time <= $${window.fromIso ? 2 : 1}::timestamptz` : ``}
        )
        SELECT
          (SELECT COUNT(*)::text FROM settled_in_window) AS settled,
          (SELECT COUNT(DISTINCT al.id)::text
             FROM auction_listings al
             JOIN settled_in_window s ON s.id = al.id
             WHERE EXISTS (
               SELECT 1 FROM auction_bid_history h WHERE h.auction_listing_id = al.id
             )) AS with_open_bids
      `,
      [window.fromIso, window.toIso].filter(Boolean) as string[]
    );
    return {
      settled: Number(res.rows[0]?.settled ?? "0"),
      withOpenBids: Number(res.rows[0]?.with_open_bids ?? "0")
    };
  }

  async getPackToListConversion24h(): Promise<{ pulled: number; listed: number }> {
    const res = await query<{ pulled: string; listed: string }>(
      `
        WITH recent AS (
          SELECT id, created_at
          FROM user_cards
          WHERE created_at >= NOW() - INTERVAL '24 hours'
        )
        SELECT
          (SELECT COUNT(*)::text FROM recent) AS pulled,
          (SELECT COUNT(DISTINCT ml.user_card_id)::text
             FROM marketplace_listings ml
             JOIN recent r ON r.id = ml.user_card_id
             WHERE ml.created_at <= r.created_at + INTERVAL '24 hours'
          ) AS listed
      `
    );
    return {
      pulled: Number(res.rows[0]?.pulled ?? "0"),
      listed: Number(res.rows[0]?.listed ?? "0")
    };
  }

  async getLatestRetentionCohort(): Promise<RetentionCohortRow | null> {
    const res = await query<{
      cohort_start: string;
      cohort_size: string;
      d1_active: string;
      d7_active: string;
      d30_active: string;
    }>(
      `
        WITH cohort AS (
          SELECT id AS user_id, date_trunc('week', created_at) AS cohort_start
          FROM app_users
          WHERE created_at < NOW() - INTERVAL '30 days'
          ORDER BY created_at DESC
          LIMIT 5000
        ),
        latest AS (
          SELECT cohort_start FROM cohort
          GROUP BY cohort_start
          ORDER BY cohort_start DESC
          LIMIT 1
        ),
        members AS (
          SELECT c.user_id, c.cohort_start
          FROM cohort c JOIN latest l ON l.cohort_start = c.cohort_start
        ),
        activity AS (
          SELECT user_id, created_at FROM user_packs
          UNION ALL
          SELECT bidder_id, bid_at FROM auction_bid_history
          UNION ALL
          SELECT user_id, created_at FROM user_cards
        )
        SELECT
          (SELECT cohort_start::text FROM latest) AS cohort_start,
          (SELECT COUNT(*)::text FROM members) AS cohort_size,
          (SELECT COUNT(DISTINCT m.user_id)::text
             FROM members m JOIN activity a ON a.user_id = m.user_id
             WHERE a.created_at >= m.cohort_start + INTERVAL '1 day'
               AND a.created_at <  m.cohort_start + INTERVAL '2 days') AS d1_active,
          (SELECT COUNT(DISTINCT m.user_id)::text
             FROM members m JOIN activity a ON a.user_id = m.user_id
             WHERE a.created_at >= m.cohort_start + INTERVAL '7 days'
               AND a.created_at <  m.cohort_start + INTERVAL '8 days') AS d7_active,
          (SELECT COUNT(DISTINCT m.user_id)::text
             FROM members m JOIN activity a ON a.user_id = m.user_id
             WHERE a.created_at >= m.cohort_start + INTERVAL '30 days'
               AND a.created_at <  m.cohort_start + INTERVAL '31 days') AS d30_active
      `
    );
    const row = res.rows[0];
    if (!row || !row.cohort_start) return null;
    return {
      cohortStart: row.cohort_start,
      cohortSize: Number(row.cohort_size),
      d1Active: Number(row.d1_active),
      d7Active: Number(row.d7_active),
      d30Active: Number(row.d30_active)
    };
  }

  /* ── Alerts ─────────────────────────────────────────────────────────── */

  async insertAlertIdempotent(input: {
    alertKey: HealthAlertKey;
    severity: HealthAlertSeverity;
    dedupBucket: string;
    context: Record<string, unknown>;
  }): Promise<void> {
    await query(
      `
        INSERT INTO health_alert_event (alert_key, severity, dedup_bucket, context)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (alert_key, dedup_bucket) WHERE dedup_bucket IS NOT NULL DO NOTHING
      `,
      [
        input.alertKey,
        input.severity,
        input.dedupBucket,
        JSON.stringify(input.context)
      ]
    );
  }

  async listOpenAlerts(): Promise<HealthAlertRow[]> {
    const res = await query<{
      id: string;
      alert_key: HealthAlertKey;
      severity: HealthAlertSeverity;
      fired_at: string;
      resolved_at: string | null;
      context: Record<string, unknown>;
    }>(
      `
        SELECT
          id::text,
          alert_key,
          severity,
          fired_at::text AS fired_at,
          resolved_at::text AS resolved_at,
          context
        FROM health_alert_event
        WHERE resolved_at IS NULL
        ORDER BY fired_at DESC
        LIMIT 50
      `
    );
    return res.rows.map(mapAlertRow);
  }

  async listRecentAlerts(limit: number): Promise<HealthAlertRow[]> {
    const res = await query<{
      id: string;
      alert_key: HealthAlertKey;
      severity: HealthAlertSeverity;
      fired_at: string;
      resolved_at: string | null;
      context: Record<string, unknown>;
    }>(
      `
        SELECT
          id::text,
          alert_key,
          severity,
          fired_at::text AS fired_at,
          resolved_at::text AS resolved_at,
          context
        FROM health_alert_event
        ORDER BY fired_at DESC
        LIMIT $1
      `,
      [limit]
    );
    return res.rows.map(mapAlertRow);
  }

  /* ── Demo helpers ───────────────────────────────────────────────────── */

  async injectSyntheticPackPurchaseEarnings(
    rows: Array<{ amountUsd: string; tierName: string }>
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const valuesSql: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const row of rows) {
      const txnId = `simulated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      valuesSql.push(
        `('pack_purchase', $${p}, $${p + 1}::numeric, 'USD', NOW(), $${p + 2}::jsonb)`
      );
      params.push(txnId, row.amountUsd, JSON.stringify({ tierName: row.tierName, simulated: true }));
      p += 3;
    }
    const res = await query<{ inserted: string }>(
      `
        WITH ins AS (
          INSERT INTO company_earnings_ledger
            (event_type, transaction_id, amount_gained_usd, currency_code, occurred_at, metadata)
          VALUES ${valuesSql.join(", ")}
          RETURNING 1
        )
        SELECT COUNT(*)::text AS inserted FROM ins
      `,
      params
    );
    return Number(res.rows[0]?.inserted ?? "0");
  }
}

/* ── helpers ──────────────────────────────────────────────────────────── */

function mapAlertRow(row: {
  id: string;
  alert_key: HealthAlertKey;
  severity: HealthAlertSeverity;
  fired_at: string;
  resolved_at: string | null;
  context: Record<string, unknown>;
}): HealthAlertRow {
  return {
    id: row.id,
    alertKey: row.alert_key,
    severity: row.severity,
    firedAt: row.fired_at,
    resolvedAt: row.resolved_at,
    context: row.context ?? {}
  };
}

function whereOccurredAt(window: WindowFilter): { clause: string; params: unknown[] } {
  return whereWindow(window, "occurred_at");
}

function whereCreatedAt(window: WindowFilter, alias: string): { clause: string; params: unknown[] } {
  return whereWindow(window, `${alias}.created_at`);
}

function whereWindow(window: WindowFilter, column: string): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (window.fromIso) {
    params.push(window.fromIso);
    conditions.push(`${column} >= $${params.length}::timestamptz`);
  }
  if (window.toIso) {
    params.push(window.toIso);
    conditions.push(`${column} <= $${params.length}::timestamptz`);
  }
  return conditions.length > 0
    ? { clause: `WHERE ${conditions.join(" AND ")}`, params }
    : { clause: "", params };
}
