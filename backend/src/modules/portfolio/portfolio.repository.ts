import { query } from "../../db";

export interface PortfolioSnapshotRow {
  id: string;
  totalPortfolioValueUsd: string;
  recordedAt: string;
}

export class PortfolioRepository {
  async insertSnapshot(userId: string, totalPortfolioValueUsd: string): Promise<PortfolioSnapshotRow> {
    const result = await query<{ id: string; total: string; recorded_at: Date }>(
      `
        INSERT INTO user_portfolio_snapshots (user_id, total_portfolio_value_usd, recorded_at)
        VALUES ($1::uuid, $2::numeric, NOW())
        RETURNING id, total_portfolio_value_usd::text AS total, recorded_at
      `,
      [userId, totalPortfolioValueUsd]
    );
    const row = result.rows[0];
    return {
      id: row.id,
      totalPortfolioValueUsd: row.total,
      recordedAt: row.recorded_at.toISOString()
    };
  }

  async listSnapshotsSince(userId: string, since: Date): Promise<PortfolioSnapshotRow[]> {
    const result = await query<{ id: string; total: string; recorded_at: Date }>(
      `
        SELECT
          id,
          total_portfolio_value_usd::text AS total,
          recorded_at
        FROM user_portfolio_snapshots
        WHERE user_id = $1::uuid AND recorded_at >= $2::timestamptz
        ORDER BY recorded_at ASC
      `,
      [userId, since.toISOString()]
    );
    return result.rows.map((r) => ({
      id: r.id,
      totalPortfolioValueUsd: r.total,
      recordedAt: r.recorded_at.toISOString()
    }));
  }

  async listAllUserIds(): Promise<string[]> {
    const result = await query<{ id: string }>(`SELECT id FROM app_users ORDER BY created_at ASC`);
    return result.rows.map((r) => r.id);
  }
}
