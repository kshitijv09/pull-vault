import type { PoolClient } from "pg";

export type CompanyEarningsEventType = "marketplace_purchase" | "auction_completion" | "pack_purchase";

export interface RecordCompanyEarningInput {
  eventType: CompanyEarningsEventType;
  transactionId: string;
  amountGainedUsd: string;
  metadata?: Record<string, unknown>;
  occurredAtIso?: string;
}

export async function recordCompanyEarning(
  client: PoolClient,
  input: RecordCompanyEarningInput
): Promise<void> {
  await client.query(
    `
      INSERT INTO company_earnings_ledger (
        event_type,
        transaction_id,
        amount_gained_usd,
        currency_code,
        occurred_at,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3::numeric,
        'USD',
        COALESCE($4::timestamptz, NOW()),
        $5::jsonb
      )
      ON CONFLICT (event_type, transaction_id) DO NOTHING
    `,
    [
      input.eventType,
      input.transactionId,
      input.amountGainedUsd,
      input.occurredAtIso ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
}
