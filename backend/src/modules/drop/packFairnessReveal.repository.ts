import { query } from "../../db";

export interface FairnessRevealHeaderRow {
  /** `user_packs.id` */
  user_pack_id: string;
  /** `user_packs.user_id` */
  user_id: string;
  drop_id: string;
  /** `user_packs.pack_id` references `pack_inventory.id`. */
  pack_inventory_id: string;
  /** `drops.fairness_mode`. */
  fairness_mode: string | null;
  /** `drops.fairness_algorithm_version`. */
  fairness_algorithm_version: string | null;
  /** `pack_fairness_commit.id` (nonce). */
  commit_id: string | null;
  client_seed: string | null;
  client_seed_source: string | null;
  server_secret_hex: string | null;
  server_commitment_hex: string | null;
  consumed_at: string | null;
  pool_fingerprint_hex: string | null;
  algorithm_version: string | null;
  transcript: Record<string, unknown> | null;
  /** `drops.pool_snapshot_created_at` for the verifier's pool reference. */
  pool_snapshot_created_at: string | null;
}

export interface FairnessRevealCardRow {
  catalog_card_id: string;
  external_card_id: string;
  name: string;
  card_set: string;
  rarity: string;
  image_url: string;
  market_value_usd: string;
  acquisition_price_usd: string;
  ordinal: number;
}

export class PackFairnessRevealRepository {
  async findHeader(userPackId: string): Promise<FairnessRevealHeaderRow | null> {
    const result = await query<FairnessRevealHeaderRow>(
      `
        SELECT
          up.id AS user_pack_id,
          up.user_id,
          up.drop_id,
          up.pack_id AS pack_inventory_id,
          d.fairness_mode,
          d.fairness_algorithm_version,
          d.pool_snapshot_created_at::text AS pool_snapshot_created_at,
          pfc.id AS commit_id,
          pfc.client_seed,
          pfc.client_seed_source,
          pfc.server_secret_hex,
          pfc.server_commitment_hex,
          pfc.consumed_at::text AS consumed_at,
          pfc.pool_fingerprint_hex,
          pfc.algorithm_version,
          pfc.transcript
        FROM user_packs up
        LEFT JOIN drops d ON d.id = up.drop_id
        LEFT JOIN pack_fairness_commit pfc ON pfc.user_pack_id = up.id
        WHERE up.id = $1::uuid
        LIMIT 1
      `,
      [userPackId]
    );
    return result.rows[0] ?? null;
  }

  async findOutcomeCards(userPackId: string): Promise<FairnessRevealCardRow[]> {
    const result = await query<FairnessRevealCardRow>(
      `
        SELECT
          c.id AS catalog_card_id,
          c.card_id AS external_card_id,
          c.name,
          c.card_set,
          c.rarity,
          c.image_url,
          c.market_value_usd::text AS market_value_usd,
          uc.acquisition_price::text AS acquisition_price_usd,
          ROW_NUMBER() OVER (ORDER BY uc.ctid ASC)::int AS ordinal
        FROM user_cards uc
        INNER JOIN card c ON c.id = uc.card_id
        WHERE uc.user_pack_id = $1::uuid
        ORDER BY uc.ctid ASC
      `,
      [userPackId]
    );
    return result.rows;
  }
}
